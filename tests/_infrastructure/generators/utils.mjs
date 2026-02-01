/**
 * Utility functions for test data generation
 */

import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ============== Seeded Random ==============

let _seed = Date.now();

/**
 * Set the random seed for reproducible generation
 */
export function setSeed(seed) {
  _seed = typeof seed === 'number' ? seed : hashString(seed);
}

/**
 * Get a seeded random number between 0 and 1
 */
export function random() {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
}

/**
 * Get a random integer between min and max (inclusive)
 */
export function randomInt(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

/**
 * Get a random element from an array
 */
export function randomChoice(array) {
  return array[Math.floor(random() * array.length)];
}

/**
 * Get multiple random elements from an array (with optional duplicates)
 */
export function randomChoices(array, count, allowDuplicates = false) {
  if (allowDuplicates) {
    return Array.from({ length: count }, () => randomChoice(array));
  }
  const shuffled = [...array].sort(() => random() - 0.5);
  return shuffled.slice(0, Math.min(count, array.length));
}

/**
 * Random boolean with given probability
 */
export function randomBool(probability = 0.5) {
  return random() < probability;
}

/**
 * Random float between min and max
 */
export function randomFloat(min, max, decimals = 2) {
  const value = min + random() * (max - min);
  return Number(value.toFixed(decimals));
}

/**
 * Hash a string to a number for seeding
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// ============== Date Utilities ==============

/**
 * Get today's date at midnight
 */
export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Add days to a date
 */
export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Subtract days from a date
 */
export function subDays(date, days) {
  return addDays(date, -days);
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date as YYYYMMDDHHmmss (for session filenames)
 */
export function formatTimestamp(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Format date as YYYY-MM-DD HH:mm:ss
 */
export function formatDateTime(date) {
  const d = new Date(date);
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * Get day of week (0 = Sunday, 6 = Saturday)
 */
export function getDayOfWeek(date) {
  return new Date(date).getDay();
}

/**
 * Check if date is a weekday
 */
export function isWeekday(date) {
  const day = getDayOfWeek(date);
  return day >= 1 && day <= 5;
}

/**
 * Generate date range from startDate to endDate
 */
export function dateRange(startDate, endDate) {
  const dates = [];
  let current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(new Date(current));
    current = addDays(current, 1);
  }
  return dates;
}

/**
 * Generate dates for past N days (including today)
 */
export function pastDays(days) {
  const end = today();
  const start = subDays(end, days - 1);
  return dateRange(start, end);
}

// ============== UUID Generation ==============

/**
 * Generate a UUID v4
 */
export function uuid() {
  return crypto.randomUUID();
}

/**
 * Generate a short ID (8 chars)
 */
export function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

// ============== File System Utilities ==============

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Write YAML file
 */
export function writeYaml(filePath, data) {
  ensureDir(path.dirname(filePath));
  const yamlStr = yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  fs.writeFileSync(filePath, yamlStr, 'utf8');
}

/**
 * Read YAML file
 */
export function readYaml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Remove directory recursively
 */
export function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

// ============== Test Data Personas ==============

export const USERS = [
  {
    id: 'popeye',
    name: 'Popeye',
    persona: 'fitness',
    birthyear: 1985,
    fitness: { max_hr: 185, resting_hr: 55 }
  },
  {
    id: 'olive',
    name: 'Olive Oyl',
    persona: 'planner',
    birthyear: 1987,
    fitness: { max_hr: 175, resting_hr: 60 }
  },
  {
    id: 'mickey',
    name: 'Mickey Mouse',
    persona: 'media',
    birthyear: 1990,
    fitness: { max_hr: 180, resting_hr: 62 }
  },
  {
    id: 'betty',
    name: 'Betty Boop',
    persona: 'music',
    birthyear: 1988,
    fitness: { max_hr: 178, resting_hr: 58 }
  },
  {
    id: 'tintin',
    name: 'Tintin',
    persona: 'guest',
    birthyear: 1995,
    fitness: { max_hr: 190, resting_hr: 52 }
  },
];

/**
 * Get primary fitness users (more active in workouts)
 */
export function getPrimaryFitnessUsers() {
  return USERS.filter(u => ['popeye', 'tintin', 'mickey'].includes(u.id));
}

/**
 * Get all active users (excludes guest)
 */
export function getActiveUsers() {
  return USERS.filter(u => u.persona !== 'guest');
}
