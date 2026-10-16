import fs from 'fs';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { isTag, isText, type Element } from 'domhandler';

import { normaliseUrl, resolveConfigPath, type SelectorOption } from './config.js';
import type { SectionName } from './transform.js';
import { fetchPage, isHtml } from './utils.js';

// ModernGov signs every page with the template it was built from:
//   <!-- modern.gov reverse CMS: https://www.example.gov.uk/template/mg.html -->
const REVERSE_CMS_COMMENT = /<!--\s*modern\.gov reverse CMS:\s*(\S+?)\s*-->/i;

const SECTIONS: readonly SectionName[] = ['pagetitle', 'breadcrumb', 'content', 'sidenav'];

export interface SetupOptions {
  moderngovUrl: string;
  localDevUrl: string;
  config?: string;
  force?: boolean;
}

export interface SetupResult {
  configPath: string;
  templateUrl: string;
  selectors: Record<SelectorOption, string>;
  warnings: string[];
}

/**
 * Escapes a class name or id for use in a CSS selector.
 *
 * @param identifier - The raw class name or id.
 * @returns The identifier, safe to put after `.` or `#`.
 */
const escapeIdentifier = (identifier: string): string =>
  identifier
    .replace(/[^\w-]/g, (char) => `\\${char}`)
    .replace(/^(-?)(\d)/, (_, dash: string, digit: string) => `${dash}\\3${digit} `);

/**
 * Finds the element a placeholder sits in.
 *
 * @param $ - The reverse CMS template.
 * @param name - The placeholder name, without braces.
 * @returns The element that holds the placeholder, or `null`.
 */
const findPlaceholder = ($: CheerioAPI, name: SectionName): Element | null => {
  // Matched the way renderTemplate matches it: any case, any inner whitespace.
  const placeholder = new RegExp(`\\{\\s*${name}\\s*\\}`, 'i');

  const holders = $('*')
    .toArray()
    .filter(isTag)
    .filter((element) =>
      element.children.some((child) => isText(child) && placeholder.test(child.data))
    );

  return holders.find((element) => $(element).closest('body').length > 0) ?? holders[0] ?? null;
};

/**
 * Describes one element as a selector step: its id when it has one, otherwise
 * its classes (or tag), narrowed by position when siblings look the same.
 *
 * @param $ - The document the element belongs to.
 * @param element - The element to describe.
 * @returns The step, and whether it is an id — which ends the walk up the tree.
 */
const selectorStep = ($: CheerioAPI, element: Element): { step: string; isId: boolean } => {
  const id = $(element).attr('id');

  if (id && !id.includes('{')) {
    return { step: `#${escapeIdentifier(id)}`, isId: true };
  }

  const classes = ($(element).attr('class') ?? '')
    .split(/\s+/)
    .filter((name) => name !== '' && !name.includes('{'));

  const tag = element.tagName.toLowerCase();
  const step = classes.length > 0 ? classes.map((name) => `.${escapeIdentifier(name)}`).join('') : tag;

  const siblings = $(element).parent().children().toArray();
  const lookalikes = siblings.filter((sibling) => $(sibling).is(step));

  if (lookalikes.length <= 1) return { step, isId: false };

  // Positional pseudo-classes count every element sibling, not just lookalikes.
  const position = siblings.indexOf(element);
  const qualified = classes.length > 0 ? step : tag;

  if (position === siblings.length - 1) return { step: `${qualified}:last-child`, isId: false };
  if (position === 0) return { step: `${qualified}:first-child`, isId: false };

  return { step: `${qualified}:nth-child(${String(position + 1)})`, isId: false };
};

/**
 * Builds the shortest selector, from the element up to its nearest ancestor
 * with an id, that matches the element and nothing else.
 *
 * @param $ - The document the element belongs to.
 * @param element - The element to point at.
 * @returns A selector that matches exactly that element.
 */
const uniqueSelector = ($: CheerioAPI, element: Element): string => {
  const steps: string[] = [];
  let current: Element | null = element;

  while (current && isTag(current)) {
    const { step, isId } = selectorStep($, current);
    steps.unshift(step);
    if (isId) break;

    current = $(current).parent().get(0) ?? null;
  }

  const matchesOnly = (candidate: string[], combinator: string): boolean => {
    const matched = $(candidate.join(combinator));
    return matched.length === 1 && matched[0] === element;
  };

  // The full child chain is unique by construction; descendant steps read
  // better and survive small changes in the markup, so they are tried first.
  if (!matchesOnly(steps, ' ')) return steps.join(' > ');

  // Drop ancestors, outermost first, while the selector still pins the element.
  const kept = [...steps];

  for (let index = 0; index < kept.length - 1; ) {
    const without = kept.filter((_, position) => position !== index);

    if (matchesOnly(without, ' ')) {
      kept.splice(index, 1);
    } else {
      index++;
    }
  }

  return kept.join(' ');
};

/**
 * Fetches a page as HTML.
 *
 * @param url - The page to fetch.
 * @param label - What the page is, for error messages.
 * @returns The final URL after redirects, and the markup.
 * @throws If the page cannot be fetched or is not HTML.
 */
const fetchHtml = async (url: string, label: string): Promise<{ url: string; html: string }> => {
  const response = await fetchPage(url);

  if (!response.ok) throw new Error(`The ${label} at ${url} responded with ${response.status}.`);
  if (!isHtml(response)) throw new Error(`The ${label} at ${url} is not an HTML page.`);

  return { url: response.url || url, html: await response.text() };
};

/**
 * Writes a config file whose selectors are discovered from the reverse CMS
 * template the live ModernGov site is built from.
 *
 * ModernGov names that template in a comment at the end of every page. The
 * template carries `{pagetitle}`, `{breadcrumb}`, `{content}` and `{sidenav}`
 * placeholders, and the element each one sits in is exactly what the matching
 * selector has to point at, since extraction takes the element's contents.
 *
 * @param options - The two URLs, plus where to write and whether to overwrite.
 * @returns What was written, and anything that looked off.
 * @throws If the live site has no reverse CMS comment, a page cannot be
 * fetched, or the config file exists and `force` is not set.
 */
export const setup = async (options: SetupOptions): Promise<SetupResult> => {
  const moderngovUrl = normaliseUrl(options.moderngovUrl, 'moderngovUrl');
  const localDevUrl = normaliseUrl(options.localDevUrl, 'localDevUrl');
  const configPath = resolveConfigPath(undefined, options.config);

  if (fs.existsSync(configPath) && !options.force) {
    throw new Error(`${configPath} already exists. Pass --force to overwrite it.`);
  }

  const live = await fetchHtml(`${moderngovUrl}/`, 'ModernGov site');
  const signature = REVERSE_CMS_COMMENT.exec(live.html);

  if (!signature) {
    throw new Error(
      `No "modern.gov reverse CMS" comment found on ${live.url}, so the template it is built from is unknown.`
    );
  }

  const templateUrl = new URL(signature[1], live.url).toString();
  const template = await fetchHtml(templateUrl, 'reverse CMS template');

  const $template = cheerio.load(template.html);
  const $live = cheerio.load(live.html);
  const warnings: string[] = [];
  const selectors = {} as Record<SelectorOption, string>;

  for (const name of SECTIONS) {
    const option: SelectorOption = `${name}Selector`;
    const holder = findPlaceholder($template, name);

    if (!holder) {
      warnings.push(`{${name}} is not in the reverse CMS template; ${option} is left empty.`);
      selectors[option] = '';
      continue;
    }

    const selector = uniqueSelector($template, holder);
    selectors[option] = selector;

    if ($live(selector).length === 0) {
      warnings.push(`${option} "${selector}" matches nothing on ${live.url}; check it by hand.`);
    }
  }

  const config = {
    moderngovUrl,
    localDevUrl,
    ...selectors,
    moderngovAssets: [],
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return { configPath, templateUrl, selectors, warnings };
};
