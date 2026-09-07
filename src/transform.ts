import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

import { isNavigable, isSameSite, resolveUrl } from './utils.js';

// Attributes that point at assets rather than pages: they keep pointing at the
// live ModernGov site so images, styles and scripts still resolve.
const ASSET_ATTRIBUTES = ['src', 'poster', 'data-src'] as const;

/** A placeholder in the local template, and the snippet that fills it. */
export type SectionName = 'pagetitle' | 'breadcrumb' | 'content' | 'sidenav';

/** Extracted markup, keyed by the placeholder it replaces. */
export type Sections = Record<SectionName, string>;

/** Where a snippet came from, and where its links should point. */
export interface RewriteContext {
  /** Full URL of the live ModernGov site. */
  moderngovUrl: string;
  /** Origin of the local server, e.g. `http://localhost:8000`. */
  localBase: string;
  /** URL of the page the markup was taken from. Defaults to `moderngovUrl`. */
  pageUrl?: string;
}

/** Everything {@link extractSections} needs to pull a page apart. */
export interface ExtractOptions extends RewriteContext {
  /** CSS selector per section; an empty selector yields an empty section. */
  selectors: Record<SectionName, string>;
}

/**
 * Rewrites URLs inside an extracted snippet, in place.
 *
 * Links and form actions that stay on the live site are pointed back at the
 * local server, so browsing and postbacks stay inside the test app. Assets and
 * external links are absolutised against the live site instead.
 *
 * @param $ - The snippet, loaded as a cheerio fragment.
 * @param context - The live site, the local origin and the source page.
 */
const rewriteUrls = ($: CheerioAPI, context: RewriteContext): void => {
  const { moderngovUrl, localBase, pageUrl } = context;

  // Relative URLs are resolved against the page they came from; only the
  // decision of what counts as "the live site" uses moderngovUrl.
  const base = pageUrl ?? moderngovUrl;

  const toLocal = (url: URL): string =>
    `${localBase}${url.pathname}${url.search}${url.hash}`;

  const localised = (url: URL): string =>
    isSameSite(url, moderngovUrl) ? toLocal(url) : url.toString();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!isNavigable(href)) return;

    const url = resolveUrl(href, base);
    if (!url) return;

    $(element).attr('href', localised(url));
  });

  $('form[action]').each((_, element) => {
    const action = $(element).attr('action');
    if (!isNavigable(action)) return;

    const url = resolveUrl(action, base);
    if (!url) return;

    // Postbacks are proxied too, so a form that submits to the live site keeps
    // pointing at the local server.
    $(element).attr('action', localised(url));
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
    const srcset = $(element).attr('srcset');
    if (!srcset) return;

    const rewritten = srcset
      .split(',')
      .map((candidate) => {
        const [value, ...descriptors] = candidate.trim().split(/\s+/);
        const url = resolveUrl(value, base);

        return [url ? url.toString() : value, ...descriptors].join(' ');
      })
      .join(', ');

    $(element).attr('srcset', rewritten);
  });
};

/**
 * Pulls the configured sections out of a live ModernGov page and rewrites their
 * URLs for local browsing.
 *
 * @param html - The page as served by the live site.
 * @param options - Selectors to extract, plus the URLs used to rewrite them.
 * @returns One snippet per section. A selector that is empty or matches
 * nothing yields an empty string rather than an error, so a partly configured
 * template still renders.
 */
export const extractSections = (html: string, options: ExtractOptions): Sections => {
  const { moderngovUrl, localBase, pageUrl, selectors } = options;
  const $ = cheerio.load(html);
  const sections = {} as Sections;

  // Object.entries widens the key to string; the selectors come from a
  // Record<SectionName, string>, so the narrower type still holds.
  for (const [name, selector] of Object.entries(selectors) as [SectionName, string][]) {
    const matched = selector ? $(selector) : null;

    if (!matched || matched.length === 0) {
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

/**
 * Builds the tag that loads an asset.
 *
 * @param url - Absolute URL of the asset.
 * @returns A `<script>` tag for JavaScript, a stylesheet `<link>` otherwise.
 */
const assetTag = (url: string): string =>
  /\.js(\?|#|$)/i.test(url)
    ? `<script src="${url}"></script>`
    : `<link rel="stylesheet" href="${url}">`;

/**
 * Injects the assets the live page loads into the local template.
 *
 * This is why `moderngovAssets` is rarely needed: whatever ModernGov links on
 * the fetched page is carried over automatically. Assets from anywhere else are
 * skipped, so the local site's own CSS and JS are not duplicated.
 *
 * @param html - The local template.
 * @param remoteHtml - The live ModernGov page to take assets from.
 * @param moderngovUrl - Full URL of the live site.
 * @returns The template with the discovered assets added to its `<head>`.
 */
export const autoInjectAssets = (
  html: string,
  remoteHtml: string,
  moderngovUrl: string
): string => {
  const $ = cheerio.load(remoteHtml);
  const assets: string[] = [];

  $('link[rel][href], script[src]').each((_, element) => {
    const isScript = element.tagName.toLowerCase() === 'script';

    const value = $(element).attr(isScript ? 'src' : 'href');
    if (!isNavigable(value)) return;

    const url = resolveUrl(value, moderngovUrl);
    if (url) assets.push(url.toString());
  });

  return injectAssets(
    html,
    assets.filter((asset) => asset.startsWith(moderngovUrl)),
    moderngovUrl
  );
};

/**
 * Injects the configured ModernGov assets into the local template's `<head>`.
 *
 * @param html - The local template.
 * @param assets - Asset URLs, absolute or relative to the live site.
 * @param moderngovUrl - Full URL of the live site, used to absolutise them.
 * @returns The template with the asset tags added. They are prepended when the
 * template has no `<head>` to put them in.
 */
export const injectAssets = (
  html: string,
  assets: readonly string[] | undefined,
  moderngovUrl: string
): string => {
  if (!assets || assets.length === 0) return html;

  const tags = assets
    .map((asset) => resolveUrl(asset, moderngovUrl))
    .filter((url): url is URL => url !== null)
    .map((url) => assetTag(url.toString()))
    .join('\n');

  if (tags === '') return html;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tags}\n</head>`);
  }

  return `${tags}\n${html}`;
};

/**
 * Replaces the placeholders in the local template with the extracted sections.
 *
 * Matching is case-insensitive and tolerates whitespace, so `{content}` and
 * `{ CONTENT }` both work.
 *
 * @param template - The page served by `localDevUrl`.
 * @param sections - Snippets keyed by placeholder name.
 * @returns The finished page.
 */
export const renderTemplate = (template: string, sections: Sections): string => {
  let html = template;

  for (const [name, snippet] of Object.entries(sections)) {
    const placeholder = new RegExp(`\\{\\s*${name}\\s*\\}`, 'gi');

    // A function replacement keeps $& and friends in the markup literal.
    html = html.replace(placeholder, () => snippet);
  }

  return html;
};
