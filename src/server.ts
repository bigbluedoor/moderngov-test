import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { ImpitResponse, RequestInit } from 'impit';

import type { Options } from './config.js';
import { autoInjectAssets, extractSections, injectAssets, renderTemplate } from './transform.js';
import { errorMessage, fetchPage, isHtml, isSameSite, resolveUrl } from './utils.js';

const DEFAULT_PORT = 8000;

/** Postbacks carry a __VIEWSTATE field, which is large but not unbounded. */
const BODY_LIMIT = '25mb';

const ALLOWED_METHODS: readonly string[] = ['GET', 'HEAD', 'POST'];

// Headers passed on to ModernGov. The rest is left alone: the cookie jar and
// the Chrome fingerprint belong to the shared impit client, and hop-by-hop
// headers describe the connection with the browser, not the one with the live
// site.
const FORWARDED_HEADERS: readonly string[] = ['content-type'];

/**
 * Reports whether a response is a redirect that has not been followed.
 *
 * @param response - The response from the live site.
 * @returns `true` for any 3xx status.
 */
const isRedirect = (response: ImpitResponse): boolean =>
  response.status >= 300 && response.status < 400;

/**
 * Points a URL on the live site back at the test app.
 *
 * @param url - Where the live site wants to send the browser.
 * @param context - The live site and the local origin.
 * @returns A local URL for ModernGov pages, the absolute URL for anywhere else.
 */
const localise = (
  url: URL,
  context: { moderngovUrl: string; localBase: string }
): string =>
  isSameSite(url, context.moderngovUrl)
    ? `${context.localBase}${url.pathname}${url.search}${url.hash}`
    : url.toString();

/**
 * Builds the request to send to the live site.
 *
 * @param req - The incoming request from the browser.
 * @param target - The URL on the live site being requested.
 * @returns Fetch options mirroring the browser's request.
 */
const remoteRequest = (req: Request, target: string): RequestInit => {
  if (req.method !== 'POST') return { method: 'GET' };

  // A postback comes from the page it is submitted on.
  const headers: Record<string, string> = { referer: target };

  for (const header of FORWARDED_HEADERS) {
    const value = req.get(header);
    if (value) headers[header] = value;
  }

  // express.raw leaves the body as a Buffer, so a postback is forwarded byte
  // for byte — __VIEWSTATE survives untouched.
  const body: unknown = req.body;

  return {
    method: 'POST',
    body: Buffer.isBuffer(body) && body.length > 0 ? body : undefined,
    headers,
    // ASP.NET answers most postbacks with a redirect; it is handled here so
    // the browser ends up on the local URL for the new page.
    redirect: 'manual',
  };
};

/**
 * Passes a non-page response straight through to the browser.
 *
 * A `GET` for an asset can simply be redirected to the live site, but a `POST`
 * cannot be replayed by the browser, so the result of a postback — an export, a
 * generated document — has to be relayed as it came.
 *
 * @param remote - The response from the live site.
 * @param res - The response to the browser.
 */
const passThrough = async (remote: ImpitResponse, res: Response): Promise<void> => {
  const disposition = remote.headers.get('content-disposition');

  if (disposition) res.set('content-disposition', disposition);

  res
    .status(remote.status)
    .type(remote.headers.get('content-type') ?? 'application/octet-stream')
    .send(Buffer.from(await remote.arrayBuffer()));
};

/**
 * Serves one request: fetches the matching ModernGov page, extracts the
 * configured sections and drops them into the local template.
 *
 * @param req - The incoming request.
 * @param res - The response to write.
 * @param options - The resolved CLI and config options.
 */
const handleRequest = async (
  req: Request,
  res: Response,
  options: Options
): Promise<void> => {
  if (!ALLOWED_METHODS.includes(req.method)) {
    res
      .status(405)
      .set('allow', ALLOWED_METHODS.join(', '))
      .type('text/plain')
      .send(`moderngov-test only serves ${ALLOWED_METHODS.join(', ')} requests.`);
    return;
  }

  const localBase = `${req.protocol}://${req.get('host')}`;
  const target = new URL(req.originalUrl, `${options.moderngovUrl}/`).toString();

  try {
    const remote = await fetchPage(target, remoteRequest(req, target));

    // Post/Redirect/Get: the browser follows with a GET, which comes back
    // through here as a normal page request.
    if (isRedirect(remote)) {
      const location = resolveUrl(remote.headers.get('location') ?? '', target);
      const moderngovUrl = options.moderngovUrl;

      res.redirect(303, location ? localise(location, { moderngovUrl, localBase }) : target);
      return;
    }

    // Anything that is not a page (images, css, downloads).
    if (!isHtml(remote)) {
      if (req.method === 'POST') {
        await passThrough(remote, res);
        return;
      }

      res.redirect(302, target);
      return;
    }

    if (!remote.ok) {
      res
        .status(remote.status)
        .type('text/plain')
        .send(`ModernGov responded with ${remote.status} for ${target}`);
      return;
    }

    const template = await fetchPage(options.localDevUrl);

    if (!template.ok) {
      throw new Error(
        `The local template at ${options.localDevUrl} responded with ${template.status}.`
      );
    }

    const remoteHtml = await remote.text();

    const sections = extractSections(remoteHtml, {
      moderngovUrl: options.moderngovUrl,
      localBase,
      // Relative hrefs and form actions belong to the page they were found on,
      // which is not always the one that was requested.
      pageUrl: remote.url || target,
      selectors: {
        pagetitle: options.pagetitleSelector,
        breadcrumb: options.breadcrumbSelector,
        content: options.contentSelector,
        sidenav: options.sidenavSelector,
      },
    });

    const templateHtml = await template.text();

    const withAutoAssets = autoInjectAssets(templateHtml, remoteHtml, options.moderngovUrl);
    const withAssets = injectAssets(withAutoAssets, options.moderngovAssets, options.moderngovUrl);

    res.status(200).type('html').send(renderTemplate(withAssets, sections));
  } catch (error) {
    const message = errorMessage(error);

    console.error(`✗ ${req.method} ${req.originalUrl} — ${message}`);
    res.status(502).type('text/plain').send(`moderngov-test could not build the page:\n${message}`);
  }
};

/**
 * Builds the proxy application.
 *
 * @param options - The resolved CLI and config options.
 * @returns An express app that serves every path from the live ModernGov site
 * wrapped in the local template.
 */
export const createApp = (options: Options): Express => {
  const app = express();

  app.disable('x-powered-by');

  // Any content type, kept raw: postbacks are urlencoded, uploads multipart.
  app.use(express.raw({ type: () => true, limit: BODY_LIMIT }));

  app.use((req, res) => {
    // The handler owns its errors, so nothing is left for express to catch.
    void handleRequest(req, res, options);
  });

  return app;
};

/**
 * Reads the port a listening server ended up on.
 *
 * @param server - A listening server.
 * @returns The port number, or `null` for a server bound to a pipe or socket.
 */
export const portOf = (server: Server): number | null => {
  const address: string | AddressInfo | null = server.address();

  return typeof address === 'object' && address !== null ? address.port : null;
};

/**
 * Starts the server, falling back to a random free port when the wanted one is
 * taken.
 *
 * @param app - The application to serve.
 * @param port - Port to try first. `0` picks a free one and never retries.
 * @returns The listening server.
 */
export const listen = (app: Express, port: number = DEFAULT_PORT): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once('listening', () => {
      resolve(server);
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EADDRINUSE' || port === 0) {
        reject(error);
        return;
      }

      console.log(`Port ${port} is in use, picking a free one instead.`);
      server.close();
      listen(app, 0).then(resolve, reject);
    });
  });

export { DEFAULT_PORT };
