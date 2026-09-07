import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isEmpty } from './utils.js';

const CONFIG_FILE = 'config.json';

// config.json lives at the package root, next to config.json.dist — not in src/.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_OPTIONS = [
  'moderngovUrl',
  'localDevUrl',
];

const SELECTOR_OPTIONS = [
  'pagetitleSelector',
  'breadcrumbSelector',
  'contentSelector',
  'sidenavSelector',
];

const OPTIONAL_OPTIONS = [...SELECTOR_OPTIONS, 'moderngovAssets', 'config'];

/**
 * Reads the config file: config.json from the package root by default, or the
 * file given inline with --config.
 * The file is optional: every value can also be passed inline.
 */
const readConfigFile = (root = PACKAGE_ROOT, configFile = null) => {
  // A path typed on the command line is resolved from the working directory,
  // like any other path would be. The implicit config.json stays at the package
  // root, next to config.json.dist.
  const configPath = isEmpty(configFile)
    ? path.join(root, CONFIG_FILE)
    : path.resolve(process.cwd(), String(configFile).trim());

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to parse ${configPath}: ${error.message}\n` +
      `Copy ${CONFIG_FILE}.dist to ${CONFIG_FILE} and fill it in.`
    );
  }
};

const toAssetList = (value) => {
  if (isEmpty(value)) return [];
  if (Array.isArray(value)) return value.filter((asset) => !isEmpty(asset));

  // Inline usage: --moderngovAssets "/a.css,/b.js"
  return String(value)
    .split(',')
    .map((asset) => asset.trim())
    .filter((asset) => asset !== '');
};

const normaliseUrl = (value, option) => {
  let url;

  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error(`The --${option} option must be a full URL, got "${value}".`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`The --${option} option must be an http(s) URL, got "${value}".`);
  }

  return url.toString().replace(/\/$/, '');
};

/**
 * Merges inline options over config.json values and validates the result.
 * Inline options always win; anything missing must come from config.json.
 */
export const resolveOptions = (cliOptions = {}, root = PACKAGE_ROOT) => {
  const config = readConfigFile(root, cliOptions['config']);
  const resolved = {};

  for (const option of [...REQUIRED_OPTIONS, ...OPTIONAL_OPTIONS]) {
    resolved[option] = isEmpty(cliOptions[option]) ? config[option] : cliOptions[option];
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
  );

  return {
    moderngovUrl: normaliseUrl(resolved.moderngovUrl, 'moderngovUrl'),
    localDevUrl: normaliseUrl(resolved.localDevUrl, 'localDevUrl'),
    ...selectors,
    moderngovAssets: toAssetList(resolved.moderngovAssets),
  };
};

export { REQUIRED_OPTIONS, OPTIONAL_OPTIONS };
