// tests/lib/endpoint-map.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, '../fixtures/parity-baselines/endpoint-map.yml');

let cachedMap = null;

/**
 * Load endpoint map from YAML config
 */
export function loadEndpointMap() {
  if (cachedMap) return cachedMap;

  const content = fs.readFileSync(MAP_PATH, 'utf-8');
  cachedMap = yaml.load(content);
  return cachedMap;
}

/**
 * Parse input string from lists.yml
 * @param {string} input - e.g., "plex: 663035" or "scripture: nt"
 * @returns {{ type: string, value: string } | null}
 */
export function parseInput(input) {
  if (!input || typeof input !== 'string') return null;

  const map = loadEndpointMap();

  for (const [type, config] of Object.entries(map)) {
    const regex = new RegExp(config.pattern);
    const match = input.match(regex);
    if (match) {
      return { type, value: match[1].trim() };
    }
  }

  return null;
}

/**
 * Build URL for endpoint
 * @param {string} type - Input type (e.g., "plex")
 * @param {string} value - Parsed value (e.g., "663035")
 * @param {'legacy' | 'ddd'} mode - Which endpoint to build
 * @returns {string}
 */
export function buildUrl(type, value, mode) {
  const map = loadEndpointMap();
  const config = map[type];

  if (!config) {
    throw new Error(`Unknown input type: ${type}`);
  }

  const template = mode === 'legacy' ? config.legacy : config.ddd;
  return template.replace(`{${config.param}}`, value);
}

/**
 * Get all supported input types
 */
export function getSupportedTypes() {
  return Object.keys(loadEndpointMap());
}
