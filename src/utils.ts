import { Impit, type ImpitResponse, type RequestInit } from 'impit';
import { CookieJar } from 'tough-cookie';

/** URL schemes that never point at a page worth rewriting. */
const NON_NAVIGABLE = /^(#|javascript:|mailto:|tel:|data:)/i;

/**
 * Reports whether a value should be treated as "not provided".
 *
 * Blank strings count as empty, which is what makes an untouched
 * `"contentSelector": ""` in `config.json` behave like a missing key.
 *
 * @param value - Any value, typically an option straight off the CLI or out of
 * the config file.
 * @returns `true` for `undefined`, `null` and whitespace-only strings.
 */
export const isEmpty = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
};

/**
 * Narrows a parsed JSON value to an object that can be indexed by key.
 *
 * @param value - The result of `JSON.parse`, or anything else of unknown shape.
 * @returns `true` when the value is a non-null, non-array object.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Resolves a possibly relative URL against a base, without throwing.
 *
 * Real markup contains URLs that `new URL()` rejects, and a single bad `href`
 * should not take down the whole page, so failure is reported as `null`.
 *
 * @param value - The URL to resolve, absolute or relative.
 * @param base - The URL to resolve it against.
 * @returns The resolved URL, or `null` when it cannot be parsed.
 */
export const resolveUrl = (value: string | undefined, base: string | URL): URL | null => {
  if (value === undefined) return null;

  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

/**
 * Reports whether an attribute value points at something worth rewriting.
 *
 * @param value - An `href`, `src` or `action` attribute, possibly absent.
 * @returns `true` for anything but empty values, fragments and the
 * `javascript:`, `mailto:`, `tel:` and `data:` schemes.
 */
export const isNavigable = (value: string | undefined | null): value is string => {
  if (isEmpty(value)) return false;

  return !NON_NAVIGABLE.test(String(value).trim());
};

/**
 * Reports whether a URL is served by a given site.
 *
 * @param url - The URL to test.
 * @param site - The site to compare against, as a full URL.
 * @returns `true` when protocol and host both match.
 */
export const isSameSite = (url: URL, site: string): boolean => {
  const base = new URL(site);

  return url.protocol === base.protocol && url.host === base.host;
};

/**
 * Reports whether a response carries a page rather than an asset or a download.
 *
 * @param response - Any response with headers.
 * @returns `true` when the `Content-Type` mentions HTML.
 */
export const isHtml = (response: ImpitResponse): boolean =>
  (response.headers.get('content-type') ?? '').toLowerCase().includes('html');

/**
 * Extracts a message from a caught value.
 *
 * `catch` binds `unknown`, so anything can be thrown; this keeps the call sites
 * free of that check.
 *
 * @param error - The caught value.
 * @returns The `Error` message, or the value stringified.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One client for the whole process. It impersonates Chrome because a plain
 * fetch is fingerprinted as a bot and served a Cloudflare challenge. TLS errors
 * are ignored so that local dev sites with self-signed certificates (Lando,
 * DDEV, …) can be used as the template source.
 *
 * The cookie jar is not optional. impit stores nothing without one, so every
 * request would arrive at ModernGov as a brand new visitor: a fresh
 * ASP.NET_SessionId each time, a {breadcrumb} that never grows past the current
 * page — it is built from the last five pages visited in the session — and
 * postbacks that lose the state they were meant to act on.
 */
const impit = new Impit({
  browser: 'chrome',
  ignoreTlsErrors: true,
  cookieJar: new CookieJar(),
});

/**
 * Fetches a page with the shared browser-impersonating client.
 *
 * @param url - The absolute URL to request.
 * @param init - Request options: `method`, `headers`, `body`, `redirect`.
 * @returns The response, whose body has not been read yet.
 */
export const fetchPage = (url: string | URL, init?: RequestInit): Promise<ImpitResponse> =>
  impit.fetch(url, init);
