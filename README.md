# moderngov-test

Utility package useful to test ModernGov template implementation.

ModernGov is hosted separately from the main site, so you cannot preview a
committee page inside your local Drupal theme until the template is live. This
tool bridges that gap: it runs a small local proxy that fetches a page from the
live ModernGov site, extracts the parts that matter (pagetitle, breadcrumb,
content, sidenav) and drops them into the template served by your local
development site.

Browsing `http://localhost:8000/<any-moderngov-path>` then shows the real
ModernGov content wrapped in your local template, with links rewritten so you
can keep clicking around without leaving the test app.

## Installation
```bash
git clone git@github.com:bigbluedoor/moderngov-test.git
```

```bash
npm install
```

```bash
npm start -- --help
```

Or use NPM link to run it straight from the repository as a CLI:
Run once
```bash
npm link
```

Then
```bash
moderngov-test --help
```

## Configuration

Copy the distributed config and fill it in:

```bash
cp config.json.dist config.json
```

```json
{
  "moderngovUrl": "https://westsussex.moderngov.co.uk",
  "localDevUrl": "https://west-sussex-lgd.lndo.site/moderngov-template",
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

***NOTE:*** moderngovAssets is not strictly required because the app autodiscover
the assets delivered from ModernGov. This setting is useful when autodiscovery
do not work properly.

`config.json` lives at the package root, next to `config.json.dist`. The file is
optional — every value can also be passed inline, and inline options always win
over the ones in the file. Selectors that are left empty simply render as an
empty string.

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

## Usage

With `config.json` in place:

```bash
npx moderngov-test
# or
npm start
```

Everything can also be passed inline:

```bash
npx moderngov-test \
  --moderngovUrl https://westsussex.moderngov.co.uk \
  --localDevUrl https://west-sussex-lgd.lndo.site/moderngov-template \
  --breadcrumbSelector ".nav--breadcrumbs ol" \
  --contentSelector "article.editor-content" \
  --sidenavSelector ".list.list--iconned" \
  --moderngovAssets "/assets/moderngov.css,/assets/moderngov.js"
```

The server starts on port **8000**; if that port is taken it falls back to a
random free one and prints the URL it ended up on:

```
moderngov-test is running on http://localhost:8000
  ModernGov site:  https://westsussex.moderngov.co.uk
  Local template:  https://west-sussex-lgd.lndo.site/moderngov-template
```

Open `http://localhost:8000/` and append any path from the live ModernGov site,
for example
`http://localhost:8000/mgCommitteeDetails.aspx?ID=123`.

## How it works

For every incoming `GET` request:

1. The same path is requested from `moderngovUrl`.
2. Non-HTML responses (images, CSS, downloads) are redirected straight to the
   live site.
3. The HTML is parsed with [cheerio](https://cheerio.js.org/) and the configured
   selectors are extracted.
4. URLs inside the extracted snippets are rewritten: links to pages on the live
   ModernGov site point back at `localhost` so browsing stays inside the test
   app, while assets, external links and form actions are absolutised against
   the live site.
5. The template from `localDevUrl` is fetched, the optional `moderngovAssets`
   are injected into its `<head>`, and the placeholders are replaced.

## Notes and limitations

- Only `GET` and `HEAD` requests are served; anything else returns `405`. Form
  postbacks are left pointing at the live ModernGov site.
- TLS certificate verification is disabled so that local development sites with
  self-signed certificates (Lando, DDEV, …) can be used as the template source.
  This is a development-only tool — do not deploy it.
- Nothing is cached: every request hits both the live site and the local
  template.
- If the live site or the local template cannot be reached, the response is a
  `502` with the underlying error message, and the error is also logged to the
  console.

## License

ISC © Marco Pagliarulo
