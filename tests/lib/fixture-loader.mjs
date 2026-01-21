// tests/lib/fixture-loader.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { parseInput } from './endpoint-map.mjs';

// Data path from environment or default
const DATA_PATH = process.env.DAYLIGHT_DATA_PATH || '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';
const LISTS_PATH = path.join(DATA_PATH, 'households/default/state/lists.yml');

/**
 * Load test fixtures from lists.yml
 * @param {Object} options
 * @param {string[]} options.types - Filter to specific types
 * @param {string} options.listsPath - Override lists.yml path
 * @returns {Promise<Array<{ type: string, value: string, label: string, uid: string }>>}
 */
export async function loadFixtures(options = {}) {
  const { types = null, listsPath = LISTS_PATH } = options;

  const content = fs.readFileSync(listsPath, 'utf-8');
  const items = yaml.load(content);

  if (!Array.isArray(items)) {
    throw new Error('lists.yml must be an array');
  }

  const fixtures = [];

  for (const item of items) {
    if (!item.input) continue;

    const parsed = parseInput(item.input);
    if (!parsed) continue;  // Skip unsupported types (like 'app')

    if (types && !types.includes(parsed.type)) continue;

    fixtures.push({
      type: parsed.type,
      value: parsed.value,
      label: item.label || parsed.value,
      uid: item.uid || null,
      rawInput: item.input
    });
  }

  return fixtures;
}

/**
 * Group fixtures by type
 * @param {Array} fixtures
 * @returns {Object<string, Array>}
 */
export function groupByType(fixtures) {
  const grouped = {};

  for (const fixture of fixtures) {
    if (!grouped[fixture.type]) {
      grouped[fixture.type] = [];
    }
    grouped[fixture.type].push(fixture);
  }

  return grouped;
}

/**
 * Get unique fixture (deduplicate by type+value)
 * @param {Array} fixtures
 * @returns {Array}
 */
export function dedupeFixtures(fixtures) {
  const seen = new Set();
  return fixtures.filter(f => {
    const key = `${f.type}:${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
