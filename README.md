# @bigbluedoor/moderngov-test

Utility package useful to test ModernGov template implementation.

ModernGov is hosted separately from the main site, so you cannot preview a
ModernGov page inside your local theme until the template is live. This
tool bridges that gap: it runs a small local proxy that fetches a page from the
live ModernGov site, extracts the parts that matter (pagetitle, breadcrumb,
content, sidenav) and drops them into the template served by your local
development site.

Browsing `http://localhost:8000/<any-moderngov-path>` then shows the real
ModernGov content wrapped in your local template, with links rewritten so you
can keep clicking around without leaving the test app.

***NOTE:*** If port 8000 is taken, a free port is picked and printed.

## Installation

Run it without installing, from the folder you want `config.json` in:

```bash
npx @bigbluedoor/moderngov-test setup --moderngovUrl … --localDevUrl …
npx @bigbluedoor/moderngov-test
```

Or install it as a global command:

```bash
npm install -g @bigbluedoor/moderngov-test
moderngov-test --help
```

Requires Node 22.12 or later.

### From a clone

```bash
git clone git@github.com:bigbluedoor/moderngov-test.git
cd moderngov-test
npm install
npm start -- --help
```

`npm link` puts the clone on your `PATH` as `moderngov-test`, so changes are
picked up without publishing.

## Configuration

### Generating it with `setup`

The quickest way to a working `config.json` is to let the tool write it:

```bash
npx @bigbluedoor/moderngov-test setup \
  --moderngovUrl https://example.moderngov.co.uk \
  --localDevUrl https://example.lndo.site/moderngov-template
# installed globally: moderngov-test setup …
# from a clone:       npm run setup -- …
```

Every ModernGov page ends with a comment naming the template it is built
from:

```html
<!-- modern.gov reverse CMS: https://www.example.gov.uk/template/mg-external.html -->
```

`setup` reads that comment, fetches that reverse CMS template, and finds the element
holding each of `{pagetitle}`, `{breadcrumb}`, `{content}` and `{sidenav}`. It
then builds the shortest CSS selector that matches only that element. Because
extraction takes an element's contents, the element around a placeholder is
the right thing to point at. `localDevUrl` is written as given, without
checking it.

It prints the selectors it found and warns when:

- a placeholder is not in the template, so its selector is left empty;
- a selector matches nothing on the live page, so it needs checking by hand;
- `{pagetitle}` only appears in `<title>`. The selector then brings along the
  text around it, such as the site name after the page title.

| Option | Description |
| --- | --- |
| `--moderngovUrl <url>` | Required. Full URL of the live ModernGov site. |
| `--localDevUrl <url>` | Required. Full URL of the local template. |
| `-c, --config <file>` | Where to write. Defaults to `config.json` in the current directory. |
| `-f, --force` | Overwrite the file if it already exists. |

### Writing it by hand

Create `config.json` with the shape below. From a clone, you can start from
the distributed copy:

```bash
cp config.json.dist config.json
```

```json
{
  "moderngovUrl": "https://example.moderngov.co.uk",
  "localDevUrl": "https://example.lndo.site/moderngov-template",
  "pagetitleSelector": "",
  "breadcrumbSelector": ".nav--breadcrumbs ol",
  "contentSelector": "article.editor-content",
  "sidenavSelector": ".list.list--iconned",
  "moderngovAssets": []
}
```

| Option | Required | Description |
| --- | --- | --- |
| `moderngovUrl` | yes | Full URL of the live ModernGov site. |
| `localDevUrl` | yes | Full URL of the local development site's ModernGov template. |
| `pagetitleSelector` | no | CSS selector for the page title on the live site. |
| `breadcrumbSelector` | no | CSS selector for the breadcrumb on the live site. |
| `contentSelector` | no | CSS selector for the main content on the live site. |
| `sidenavSelector` | no | CSS selector for the side navigation on the live site. |
| `moderngovAssets` | no | List of ModernGov assets (CSS/JS) to inject into the template `<head>`. |

***NOTE:*** with no selectors set, every placeholder renders empty, so set at
least one of `pagetitleSelector`, `breadcrumbSelector`, `contentSelector` or
`sidenavSelector` to see ModernGov content in the template.

***NOTE:*** `moderngovAssets` is rarely needed: the app autodiscovers the assets
delivered by ModernGov on the fetched page. Use this setting when autodiscovery
misses something.

The file is optional — every value can also be passed inline, and inline options
always win over the ones in the file. Selectors that are left empty simply
render as an empty string.

### Where the config file is read from

By default the tool looks for `config.json` in the directory you run the
command in, and `setup` writes it there too. That makes a folder per site the
natural layout. From a clone, `npm start` and `npm run setup` run in the
package root, so the file sits next to `config.json.dist`.

A different file can be pointed at with `-c` / `--config`, which is a CLI-only
option (it has no meaning inside the JSON):

```bash
moderngov-test --config /Users/me/sites/example.moderngov.json
```

This is the practical way to keep several site configs in one place.

Absolute paths are used as given; relative paths are resolved from the directory
you run the command in, so this works from anywhere:

```bash
moderngov-test --config ./westsussex.moderngov.json
```

A `--config` path that does not exist is ignored silently, so a typo shows up as
a "missing required option" error rather than a "file not found" one.

## Template placeholders

The page served by `localDevUrl` is a normal page from your local site
containing placeholders where the ModernGov markup should go:

```html
<h1>{pagetitle}</h1>
{breadcrumb}
<div class="layout">
  <main>{content}</main>
  <aside>{sidenav}</aside>
</div>
```

`{pagetitle}`, `{breadcrumb}`, `{content}` and `{sidenav}` are replaced with the
snippets matched by the corresponding selectors. Matching is case-insensitive
and tolerates whitespace (`{ content }` works too).

Each selector contributes the **contents** of the element it matches, not the
element itself, which is how ModernGov behaves on the live site: the template
owns the wrapper markup and only the items come from ModernGov. So
`breadcrumbSelector: ".nav--breadcrumbs ol"` yields the `<li>` items, and the
`<ol>` around `{breadcrumb}` belongs in your template. Point a selector at the
container whose insides you want.

Note that ModernGov builds the breadcrumb from the last five pages visited in
the session, not from the page's position in a hierarchy. It therefore grows as
you browse: landing straight on a councillor page shows one item, reaching it
from the councillor index shows two. The test app keeps a session for exactly
this reason, so the trail behaves as it does in a browser.

## Usage

With `config.json` in place:

```bash
npx @bigbluedoor/moderngov-test
# installed globally
moderngov-test
# from a clone
npm start
```

With a config file kept somewhere else:

```bash
npx @bigbluedoor/moderngov-test --config /Users/me/sites/example.moderngov.json
```

Everything can also be passed inline:

```bash
npx @bigbluedoor/moderngov-test \
  --moderngovUrl https://example.moderngov.co.uk \
  --localDevUrl https://example.lndo.site/moderngov-template \
  --breadcrumbSelector ".nav--breadcrumbs ol" \
  --contentSelector "article.editor-content" \
  --sidenavSelector ".list.list--iconned" \
  --moderngovAssets "/assets/moderngov.css,/assets/moderngov.js"
```

The server starts on port **8000**; if that port is taken it falls back to a
random free one and prints the URL it ended up on:

```
moderngov-test is running on http://localhost:8000
  ModernGov site:  https://example.moderngov.co.uk
  Local template:  https://example.lndo.site/moderngov-template
```

Open `http://localhost:8000/` and append any path from the live ModernGov site,
for example
`http://localhost:8000/mgCommitteeDetails.aspx?ID=123`.

## How it works

For every incoming request:

1. The same path is requested from `moderngovUrl` with
   [impit](https://github.com/apify/impit), which impersonates Chrome. A plain
   `fetch` is fingerprinted as a bot and gets served a Cloudflare challenge
   instead of the page.
2. Non-HTML responses (images, CSS, downloads) are redirected straight to the
   live site.
3. The HTML is parsed with [cheerio](https://cheerio.js.org/) and the contents
   of the elements matched by the configured selectors are extracted.
4. URLs inside the extracted snippets are rewritten: links and form actions
   pointing at the live ModernGov site come back to `localhost` so browsing
   stays inside the test app, while assets and external links are absolutised
   against the live site.
5. The template from `localDevUrl` is fetched, the ModernGov stylesheets and
   scripts found on the live page are injected into its `<head>` (plus anything
   listed in `moderngovAssets`), and the placeholders are replaced.

### Form postbacks

ModernGov is ASP.NET WebForms, so searches, filters and paging are `POST`
requests carrying a `__VIEWSTATE` field. These are proxied too:

- the raw body is forwarded byte for byte with its original content type, so
  `__VIEWSTATE` and file uploads survive intact;
- one HTTP client, with one cookie jar, is shared for the life of the process,
  so the `ASP.NET_SessionId` is kept between requests;
- ASP.NET answers most postbacks with a redirect — the browser is sent on to
  the local URL for the new page, so the address bar keeps up;
- when a postback returns something that is not a page (an iCal feed, a
  generated PDF), the bytes are passed through with their `Content-Type` and
  `Content-Disposition` rather than redirected, since a browser cannot replay
  the `POST` against the live site.

## Notes and limitations

- Only `GET`, `HEAD` and `POST` requests are served; anything else returns
  `405`.
- Request bodies are capped at 25 MB.
- The ASP.NET session is shared by every browser pointed at the test app. That
  is fine for one developer, but two people browsing the same instance will
  tread on each other's postbacks.
- TLS certificate verification is disabled (`ignoreTlsErrors`) so that local
  development sites with self-signed certificates (Lando, DDEV, …) can be used
  as the template source. This is a development-only tool — do not deploy it.
- Nothing is cached: every request hits both the live site and the local
  template.
- If the live site or the local template cannot be reached, the response is a
  `502` with the underlying error message, and the error is also logged to the
  console.

## Development

The source lives in `src/` and is compiled to `dist/`, which is what the `bin`
entry points at. `dist/` is generated — never edit it, and never
commit it.

| Command | Does |
| --- | --- |
| `npm run build` | Compiles `src/` to `dist/` and makes the CLI executable. |
| `npm run dev` | Same, in watch mode. |
| `npm run typecheck` | Types only, no output. |
| `npm run lint` | ESLint, including the type-aware rules. |
| `npm run lint:fix` | The same, applying the fixes it can. |
| `npm run clean` | Removes `dist/`. |

`npm start` builds first, so it always runs current code. `npm install` and
`npm link` build too, via `prepare` — the CLI works straight after linking.

TypeScript is configured for Node ESM (`module: nodenext`), which means
**relative imports keep the `.js` extension even in `.ts` files**:

```ts
import { isEmpty } from './utils.js'; // resolves to ./utils.ts, emits ./utils.js
```

ESLint runs typescript-eslint's type-aware rules over `src/`. The only
JavaScript left in the repo is tooling — `eslint.config.js` itself — which sits
outside the tsconfig project and is linted without those rules.

### Publishing

```bash
npm version patch   # or minor / major; --version reads it from package.json
npm publish
```

`npm version` commits and tags the bump, so it needs a clean working tree.
`prepublishOnly` wipes `dist/` and lints, then `prepare` rebuilds, so only fresh
output ships. The package contains just the compiled JavaScript,
`config.json.dist` and this README. `npm pack --dry-run` lists what would go
out. `publishConfig.access` is `public`, which a scoped package needs to
publish for free.

## License

MIT © [Big Blue Door Limited](https://www.bigbluedoor.net/)

Maintained by Marco Pagliarulo.
