import express from 'express';

import { autoInjectAssets, extractSections, injectAssets, renderTemplate } from './transform.js';
import { fetchPage, isHtml } from './utils.js';

const DEFAULT_PORT = 8000;

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

      const remoteHtml = await remote.text();

      const sections = extractSections(remoteHtml, {
        moderngovUrl: options.moderngovUrl,
        localBase,
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
