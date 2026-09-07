import * as cheerio from 'cheerio';

import { isNavigable, isSameSite, resolveUrl } from './utils.js';

// Attributes that point at assets rather than pages: they keep pointing at the
// live ModernGov site so images, styles and scripts still resolve.
const ASSET_ATTRIBUTES = ['src', 'poster', 'data-src'];

/**
 * Rewrites URLs inside an extracted snippet.
 *
 * - links to a page on the live site become links to the local server, so
 *   browsing stays inside the test app;
 * - everything else is absolutised against the live site.
 */
const rewriteUrls = ($, { moderngovUrl, localBase, pageUrl }) => {
  // Relative URLs are resolved against the page they came from; only the
  // decision of what counts as "the live site" uses moderngovUrl.
  const base = pageUrl || moderngovUrl;

  const toLocal = (url) => `${localBase}${url.pathname}${url.search}${url.hash}`;

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!isNavigable(href)) return;

    const url = resolveUrl(href, base);
    if (!url) return;

    $(element).attr('href', isSameSite(url, moderngovUrl) ? toLocal(url) : url.toString());
  });

  $('form[action]').each((_, element) => {
    const action = $(element).attr('action');
    if (!isNavigable(action)) return;

    const url = resolveUrl(action, base);
    if (!url) return;

    // Postbacks are proxied too, so a form that submits to the live site keeps
    // pointing at the local server.
    $(element).attr('action', isSameSite(url, moderngovUrl) ? toLocal(url) : url.toString());
  });

  for (const attribute of ASSET_ATTRIBUTES) {
    $(`[${attribute}]`).each((_, element) => {
      const value = $(element).attr(attribute);
      if (!isNavigable(value)) return;

      const url = resolveUrl(value, base);
      if (url) $(element).attr(attribute, url.toString());
    });
  }

  $('link[href]').each((_, element) => {
    const url = resolveUrl($(element).attr('href'), base);
    if (url) $(element).attr('href', url.toString());
  });

  $('[srcset]').each((_, element) => {
    const srcset = $(element)
      .attr('srcset')
      .split(',')
      .map((candidate) => {
        const [value, ...descriptors] = candidate.trim().split(/\s+/);
        const url = resolveUrl(value, base);
        return [url ? url.toString() : value, ...descriptors].join(' ');
      })
      .join(', ');

    $(element).attr('srcset', srcset);
  });
};

/**
 * Pulls the breadcrumb, content and sidenav out of a live ModernGov page and
 * rewrites their URLs for local browsing.
 */
export const extractSections = (html, { moderngovUrl, localBase, pageUrl, selectors }) => {
  const $ = cheerio.load(html);
  const sections = {};

  for (const [name, selector] of Object.entries(selectors)) {
    if (!selector) {
      sections[name] = '';
      continue;
    }

    const matched = $(selector);

    if (matched.length === 0) {
      sections[name] = '';
      continue;
    }

    const snippet = cheerio.load(
      matched
        .map((_, element) => $.html(element))
        .get()
        .join('\n'),
      null,
      false
    );

    rewriteUrls(snippet, { moderngovUrl, localBase, pageUrl });
    sections[name] = snippet.html();
  }

  return sections;
};

const assetTag = (url) =>
  /\.js(\?|#|$)/i.test(url)
    ? `<script src="${url}"></script>`
    : `<link rel="stylesheet" href="${url}">`;

/**
 * Auto Injects the ModernGov assets into the local template's <head>.
 */
export const autoInjectAssets = (html, remoteHtml, moderngovUrl) => {
  const $ = cheerio.load(remoteHtml);
  const assets = [];
  $('link[rel][href], script[src]').each((_, element) => {
    const isScript = element.tagName.toLowerCase() === 'script';

    const value = $(element).attr(isScript ? 'src' : 'href');
    if (!isNavigable(value)) return;

    const url = resolveUrl(value, moderngovUrl);
    if (url) assets.push(url.toString());
  });

  return injectAssets(html, assets.filter(v => v.startsWith(moderngovUrl)), moderngovUrl);
}

/**
 * Injects the optional ModernGov assets into the local template's <head>.
 */
export const injectAssets = (html, assets, moderngovUrl) => {
  if (!assets || assets.length === 0) return html;

  const tags = assets
    .map((asset) => resolveUrl(asset, moderngovUrl))
    .filter(Boolean)
    .map((url) => assetTag(url.toString()))
    .join('\n');

  if (tags === '') return html;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tags}\n</head>`);
  }

  return `${tags}\n${html}`;
};

/**
 * Replaces {pagetitle}, {breadcrumb}, {content} and {sidenav} in the local template.
 */
export const renderTemplate = (template, sections) => {
  let html = template;

  for (const [name, snippet] of Object.entries(sections)) {
    const placeholder = new RegExp(`\\{\\s*${name}\\s*\\}`, 'gi');
    html = html.replace(placeholder, () => snippet);
  }

  return html;
};
