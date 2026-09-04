import express from 'express';

import { extractSections, injectAssets, renderTemplate } from './transform.js';

const DEFAULT_PORT = 8000;

const isHtml = (response) =>
  (response.headers.get('content-type') || '').toLowerCase().includes('html');

const fetchPage = async (url) => {
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'moderngov-test' },
  });

  return response;
};

export const createApp = (options) => {
  const app = express();

  app.disable('x-powered-by');

  app.use(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).type('text/plain').send('moderngov-test only serves GET requests.');
      return;
    }

    const localBase = `${req.protocol}://${req.get('host')}`;
    const target = new URL(req.originalUrl, `${options.moderngovUrl}/`).toString();

    try {
      const remote = await fetchPage(target);

      // Anything that is not a page (images, css, downloads) is served by the
      // live site directly.
      if (!isHtml(remote)) {
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

      const sections = extractSections(await remote.text(), {
        moderngovUrl: options.moderngovUrl,
        localBase,
        selectors: {
          pagetitle: options.pagetitleSelector,
          breadcrumb: options.breadcrumbSelector,
          content: options.contentSelector,
          sidenav: options.sidenavSelector,
        },
      });

      const html = renderTemplate(
        injectAssets(await template.text(), options.moderngovAssets, options.moderngovUrl),
        sections
      );

      res.status(200).type('html').send(html);
    } catch (error) {
      console.error(`✗ ${req.method} ${req.originalUrl} — ${error.message}`);
      res.status(502).type('text/plain').send(`moderngov-test could not build the page:\n${error.message}`);
    }
  });

  return app;
};

/**
 * Listens on port 3000, falling back to a random free port when it is taken.
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
