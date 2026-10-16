import fs from 'fs';
import path from 'path';

import { errorMessage, isEmpty, isPlainObject } from './utils.js';

// config.json is looked for in the directory the command runs in.
const CONFIG_FILE = 'config.json';

const REQUIRED_OPTIONS = ['moderngovUrl', 'localDevUrl'] as const;

const SELECTOR_OPTIONS = [
  'pagetitleSelector',
  'breadcrumbSelector',
  'contentSelector',
  'sidenavSelector',
] as const;

const OPTIONAL_OPTIONS = [...SELECTOR_OPTIONS, 'moderngovAssets', 'config'] as const;

/** An option naming a selector on the live ModernGov page. */
export type SelectorOption = (typeof SELECTOR_OPTIONS)[number];

/**
 * Options as they arrive: from commander, where everything is an optional
 * string, or from `config.json`, where `moderngovAssets` may be an array.
 */
export type CliOptions = Partial<Record<(typeof REQUIRED_OPTIONS)[number], string>> &
  Partial<Record<SelectorOption, string>> & {
    config?: string;
    moderngovAssets?: string | string[];
  };

/** Options after merging, validation and normalisation — what the server runs on. */
export type Options = Record<SelectorOption, string> & {
  moderngovUrl: string;
  localDevUrl: string;
  moderngovAssets: string[];
};

/**
 * Works out which config file is meant.
 *
 * @param root - Directory the implicit `config.json` lives in.
 * @param configFile - Path from `--config`. Absolute paths are used as given,
 * relative ones resolve from the working directory, the way a path typed on the
 * command line is expected to.
 * @returns The absolute path of the config file, which may not exist yet.
 */
export const resolveConfigPath = (
  root: string = process.cwd(),
  configFile?: string
): string =>
  isEmpty(configFile)
    ? path.join(root, CONFIG_FILE)
    : path.resolve(process.cwd(), String(configFile).trim());

/**
 * Reads the config file.
 *
 * The file is optional at both locations: every value can also be passed
 * inline, so a missing file yields no values rather than an error.
 *
 * @param root - Directory the implicit `config.json` lives in.
 * @param configFile - Path from `--config`, see {@link resolveConfigPath}.
 * @returns The parsed object, or `{}` when there is no file to read.
 * @throws If the file exists but does not contain a JSON object.
 */
const readConfigFile = (
  root: string = process.cwd(),
  configFile?: string
): Record<string, unknown> => {
  const configPath = resolveConfigPath(root, configFile);

  if (!fs.existsSync(configPath)) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to parse ${configPath}: ${errorMessage(error)}\n` +
        `Copy ${CONFIG_FILE}.dist to ${CONFIG_FILE} and fill it in.`,
      { cause: error }
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `${configPath} must contain a JSON object, like ${CONFIG_FILE}.dist does.`
    );
  }

  return parsed;
};

/**
 * Normalises the asset option to a list.
 *
 * @param value - An array from `config.json`, or the comma separated string
 * that inline usage produces: `--moderngovAssets "/a.css,/b.js"`.
 * @returns The assets, with blank entries dropped.
 */
const toAssetList = (value: unknown): string[] => {
  if (isEmpty(value)) return [];

  if (Array.isArray(value)) {
    return value.filter((asset): asset is string => !isEmpty(asset)).map(String);
  }

  return String(value)
    .split(',')
    .map((asset) => asset.trim())
    .filter((asset) => asset !== '');
};

/**
 * Validates a URL option and strips its trailing slash.
 *
 * @param value - The configured value.
 * @param option - Option name, used to name the offending flag in the error.
 * @returns The URL as a string, without a trailing slash.
 * @throws If the value is not a full http(s) URL.
 */
export const normaliseUrl = (value: unknown, option: string): string => {
  let url: URL;

  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error(`The --${option} option must be a full URL, got "${String(value)}".`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`The --${option} option must be an http(s) URL, got "${String(value)}".`);
  }

  return url.toString().replace(/\/$/, '');
};

/**
 * Merges inline options over the config file and validates the result.
 *
 * Inline options always win; anything missing must come from the file. Empty
 * selectors are kept as empty strings, which renders their placeholder as
 * nothing rather than failing.
 *
 * @param cliOptions - Options as parsed by commander.
 * @param root - Directory the implicit `config.json` lives in, overridable for testing.
 * @returns The options the server runs on.
 * @throws If a required option is missing or a URL option is malformed.
 */
export const resolveOptions = (
  cliOptions: CliOptions = {},
  root: string = process.cwd()
): Options => {
  const config = readConfigFile(root, cliOptions.config);
  const inline = cliOptions as Record<string, unknown>;
  const resolved: Record<string, unknown> = {};

  for (const option of [...REQUIRED_OPTIONS, ...OPTIONAL_OPTIONS]) {
    resolved[option] = isEmpty(inline[option]) ? config[option] : inline[option];
  }

  const missing = REQUIRED_OPTIONS.filter((option) => isEmpty(resolved[option]));

  if (missing.length > 0) {
    throw new Error(
      `Missing required option(s): ${missing.join(', ')}.\n` +
        `Pass them inline (e.g. --${missing[0]} <value>) or set them in ${CONFIG_FILE}.`
    );
  }

  const selectors = Object.fromEntries(
    SELECTOR_OPTIONS.map((option) => [
      option,
      isEmpty(resolved[option]) ? '' : String(resolved[option]).trim(),
    ])
  ) as Record<SelectorOption, string>;

  return {
    moderngovUrl: normaliseUrl(resolved.moderngovUrl, 'moderngovUrl'),
    localDevUrl: normaliseUrl(resolved.localDevUrl, 'localDevUrl'),
    ...selectors,
    moderngovAssets: toAssetList(resolved.moderngovAssets),
  };
};

export { REQUIRED_OPTIONS, OPTIONAL_OPTIONS, SELECTOR_OPTIONS };
