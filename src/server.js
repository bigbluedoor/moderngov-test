import express from 'express';

import { autoInjectAssets, extractSections, injectAssets, renderTemplate } from './transform.js';
import { fetchPage, isHtml, isSameSite, resolveUrl } from './utils.js';

const DEFAULT_PORT = 8000;
const BODY_LIMIT = '25mb';

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST'];

// Headers passed on to ModernGov. The rest is left alone: the cookie jar and
// the Chrome fingerprint belong to the shared impit client, and hop-by-hop
// headers describe the connection with the browser, not the one with the live
// site.
const FORWARDED_HEADERS = ['content-type'];

const isRedirect = (response) => response.status >= 300 && response.status < 400;

/**
 * Sends the browser to a URL on the live site, keeping it inside the test app
 * when that URL is a ModernGov page.
 */
const localise = (url, { moderngovUrl, localBase }) =>
  isSameSite(url, moderngovUrl)
    ? `${localBase}${url.pathname}${url.search}${url.hash}`
    : url.toString();

const remoteRequest = (req, target) => {
  if (req.method !== 'POST') return { method: 'GET' };

  // A postback comes from the page it is submitted on.
  const headers = { referer: target };

  for (const header of FORWARDED_HEADERS) {
    const value = req.get(header);
    if (value) headers[header] = value;
  }

  return {
    method: 'POST',
    // express.raw leaves the body as a Buffer, so a postback is forwarded
    // byte for byte — __VIEWSTATE survives untouched.
    body: req.body?.length ? req.body : undefined,
    headers,
    // ASP.NET answers most postbacks with a redirect; it is handled here so
    // the browser ends up on the local URL for the new page.
    redirect: 'manual',
  };
};

export const createApp = (options) => {
  const app = express();

  app.disable('x-powered-by');

  // Any content type, kept raw: postbacks are urlencoded, uploads multipart.
  app.use(express.raw({ type: () => true, limit: BODY_LIMIT }));

  app.use(async (req, res) => {
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
        const location = resolveUrl(remote.headers.get('location') || '', target);
        res.redirect(303, location ? localise(location, { ...options, localBase }) : target);
        return;
      }

      // Anything that is not a page (images, css, downloads).
      if (!isHtml(remote)) {
        // A GET can be handed to the live site directly, but a POST cannot be
        // replayed by the browser, so its result — an export, a generated
        // document — is passed through as it came.
        if (req.method === 'POST') {
          const disposition = remote.headers.get('content-disposition');

          if (disposition) res.set('content-disposition', disposition);

          res
            .status(remote.status)
            .type(remote.headers.get('content-type') || 'application/octet-stream')
            .send(Buffer.from(await remote.arrayBuffer()));
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
        // Relative hrefs and form actions belong to the page they were found
        // on, which is not always the one that was requested.
        pageUrl: remote.url || target,
        selectors: {
          pagetitle: options.pagetitleSelector,
          breadcrumb: options.breadcrumbSelector,
          content: options.contentSelector,
          sidenav: options.sidenavSelector,
        },
      });

      const templateHtml = await template.text();

      const withAutoAssets = autoInjectAssets(
        templateHtml,
        remoteHtml,
        options.moderngovUrl
      )
      const withAssets = injectAssets(withAutoAssets, options.moderngovAssets, options.moderngovUrl);

      const html = renderTemplate(withAssets, sections);

      res.status(200).type('html').send(html);
    } catch (error) {
      console.error(`✗ ${req.method} ${req.originalUrl} — ${error.message}`);
      res.status(502).type('text/plain').send(`moderngov-test could not build the page:\n${error.message}`);
    }
  });

  return app;
};

/**
 * Listens on DEFAULT_PORT, falling back to a random free port when it is taken.
 */
export const listen = (app, port = DEFAULT_PORT) =>
  new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once('listening', () => resolve(server));
    server.once('error', (error) => {
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
