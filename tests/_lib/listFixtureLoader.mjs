// tests/_lib/listFixtureLoader.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BASE_PATH = process.env.DAYLIGHT_BASE_PATH;
if (!BASE_PATH) {
  throw new Error('DAYLIGHT_BASE_PATH not set in environment');
}

const LISTS_PATH = path.join(BASE_PATH, 'data/household/config/lists');

/**
 * List YAML files in a directory (without extension)
 */
function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yml'))
    .map(f => f.replace('.yml', ''));
}

/**
 * Get all expected lists from data mount
 * @returns {{ menus: string[], programs: string[], watchlists: string[] }}
 */
export function getExpectedLists() {
  return {
    menus: listYamlFiles(path.join(LISTS_PATH, 'menus')),
    programs: listYamlFiles(path.join(LISTS_PATH, 'programs')),
    watchlists: listYamlFiles(path.join(LISTS_PATH, 'watchlists'))
  };
}

/**
 * Get items from a specific list
 * @param {string} type - List type (menus, programs, watchlists)
 * @param {string} name - List name (without .yml)
 * @returns {Array} List items
 */
export function getListItems(type, name) {
  const filePath = path.join(LISTS_PATH, type, `${name}.yml`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = yaml.load(content);
  // YAML files are arrays at root, not objects with 'items' key
  return Array.isArray(data) ? data : (data?.items || []);
}

/**
 * Sample random items from array
 * @param {Array} items - Items to sample from
 * @param {number} count - Max items to return
 * @returns {Array} Sampled items with original indices
 */
export function sampleItems(items, count = 20) {
  if (!items || items.length === 0) return [];
  if (items.length <= count) {
    return items.map((item, idx) => ({ ...item, originalIndex: idx }));
  }

  // Fisher-Yates shuffle to get random sample
  const indices = items.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, count)
    .sort((a, b) => a - b) // Keep in original order for easier debugging
    .map(idx => ({ ...items[idx], originalIndex: idx }));
}

/**
 * Get the lists path for debugging
 */
export function getListsPath() {
  return LISTS_PATH;
}
