import * as cheerio from 'cheerio';

// Attributes that point at assets rather than pages: they keep pointing at the
// live ModernGov site so images, styles and scripts still resolve.
const ASSET_ATTRIBUTES = ['src', 'poster', 'data-src'];

const isSameSite = (url, moderngovUrl) => {
  const site = new URL(moderngovUrl);
  return url.protocol === site.protocol && url.host === site.host;
};

const resolve = (value, base) => {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

const isNavigable = (value) =>
  value !== undefined &&
  value !== null &&
  value.trim() !== '' &&
  !/^(#|javascript:|mailto:|tel:|data:)/i.test(value.trim());

/**
 * Rewrites URLs inside an extracted snippet.
 *
 * - links to a page on the live site become links to the local server, so
 *   browsing stays inside the test app;
 * - everything else is absolutised against the live site.
 */
const rewriteUrls = ($, moderngovUrl, localBase) => {
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!isNavigable(href)) return;

    const url = resolve(href, moderngovUrl);
    if (!url) return;

    if (isSameSite(url, moderngovUrl)) {
      $(element).attr('href', `${localBase}${url.pathname}${url.search}${url.hash}`);
    } else {
      $(element).attr('href', url.toString());
    }
  });

  $('form[action]').each((_, element) => {
    const action = $(element).attr('action');
    if (!isNavigable(action)) return;

    // Postbacks are left on the live site: the test app only serves GET pages.
    const url = resolve(action, moderngovUrl);
    if (url) $(element).attr('action', url.toString());
  });

  for (const attribute of ASSET_ATTRIBUTES) {
    $(`[${attribute}]`).each((_, element) => {
      const value = $(element).attr(attribute);
      if (!isNavigable(value)) return;

      const url = resolve(value, moderngovUrl);
      if (url) $(element).attr(attribute, url.toString());
    });
  }

  $('link[href]').each((_, element) => {
    const url = resolve($(element).attr('href'), moderngovUrl);
    if (url) $(element).attr('href', url.toString());
  });

  $('[srcset]').each((_, element) => {
    const srcset = $(element)
      .attr('srcset')
      .split(',')
      .map((candidate) => {
        const [value, ...descriptors] = candidate.trim().split(/\s+/);
        const url = resolve(value, moderngovUrl);
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
export const extractSections = (html, { moderngovUrl, localBase, selectors }) => {
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

    rewriteUrls(snippet, moderngovUrl, localBase);
    sections[name] = snippet.html();
  }

  return sections;
};

const assetTag = (url) =>
  /\.js(\?|#|$)/i.test(url)
    ? `<script src="${url}"></script>`
    : `<link rel="stylesheet" href="${url}">`;

/**
 * Injects the optional ModernGov assets into the local template's <head>.
 */
export const injectAssets = (html, assets, moderngovUrl) => {
  if (!assets || assets.length === 0) return html;

  const tags = assets
    .map((asset) => resolve(asset, moderngovUrl))
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
