/**
 * Shared utilities for live test harness
 */

import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

/**
 * Get the data directory from environment
 */
export function getDataPath() {
  return process.env.DAYLIGHT_DATA_PATH;
}

/**
 * Read and parse a YAML data file
 * @param {string} relativePath - Path relative to data directory
 * @returns {object|array|null} Parsed YAML content or null if not found
 */
export function readYamlFile(relativePath) {
  const dataPath = getDataPath();
  if (!dataPath) return null;

  const fullPath = path.join(dataPath, relativePath);
  if (!fs.existsSync(fullPath)) return null;

  const content = fs.readFileSync(fullPath, 'utf8');
  return yaml.load(content);
}

/**
 * Get file modification time
 * @param {string} relativePath - Path relative to data directory
 * @returns {Date|null} File mtime or null if not found
 */
export function getFileMtime(relativePath) {
  const dataPath = getDataPath();
  if (!dataPath) return null;

  const fullPath = path.join(dataPath, relativePath);
  if (!fs.existsSync(fullPath)) return null;

  const stats = fs.statSync(fullPath);
  return stats.mtime;
}

/**
 * Check if file has entries for a date range
 * @param {object|array} data - Parsed data file
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @param {string} dateField - Field name containing date (default: 'date')
 * @returns {boolean} True if entries exist in range
 */
export function hasEntriesInRange(data, startDate, endDate = null, dateField = 'date') {
  endDate = endDate || startDate;

  // Handle array of entries
  if (Array.isArray(data)) {
    return data.some(entry => {
      const entryDate = entry[dateField]?.substring(0, 10);
      return entryDate >= startDate && entryDate <= endDate;
    });
  }

  // Handle object keyed by date
  if (data && typeof data === 'object') {
    const dates = Object.keys(data).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
    return dates.some(d => d >= startDate && d <= endDate);
  }

  return false;
}

/**
 * Get today's date in ISO format
 * @returns {string} YYYY-MM-DD
 */
export function getToday() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get date N days ago in ISO format
 * @param {number} days - Number of days ago
 * @returns {string} YYYY-MM-DD
 */
export function getDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
