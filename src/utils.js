import { Impit } from 'impit';

/**
 * True for undefined, null and blank strings — anything a caller should treat
 * as "not provided".
 */
export const isEmpty = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
};

/**
 * Resolves value against base, returning null instead of throwing on the
 * malformed URLs that turn up in real markup.
 */
export const resolveUrl = (value, base) => {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

/**
 * True when value is a URL worth rewriting, i.e. not a fragment or a
 * non-navigable scheme.
 */
export const isNavigable = (value) =>
  !isEmpty(value) && !/^(#|javascript:|mailto:|tel:|data:)/i.test(value.trim());

/**
 * True when url is served by the same protocol and host as site.
 */
export const isSameSite = (url, site) => {
  const base = new URL(site);
  return url.protocol === base.protocol && url.host === base.host;
};

/**
 * True when the response carries HTML rather than an asset or a download.
 */
export const isHtml = (response) =>
  (response.headers.get('content-type') || '').toLowerCase().includes('html');

// One client for the whole process. It impersonates Chrome because a plain
// fetch is fingerprinted as a bot and served a Cloudflare challenge, and it
// keeps any clearance cookies between requests. TLS errors are ignored so that
// local dev sites with self-signed certificates (Lando, DDEV, …) can be used
// as the template source.
const impit = new Impit({
  browser: 'chrome',
  ignoreTlsErrors: true,
});

/**
 * Fetches a page with the shared browser-impersonating client. `init` takes the
 * same shape as the one fetch() accepts: method, headers, body, redirect.
 */
export const fetchPage = (url, init) => impit.fetch(url, init);
