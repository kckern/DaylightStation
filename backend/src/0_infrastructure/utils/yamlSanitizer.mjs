/**
 * YAML Sanitization Utilities
 *
 * Functions for sanitizing strings and objects to be YAML-safe.
 * Migrated from: backend/_legacy/lib/mediaMemory.mjs:23-64
 *
 * @module infrastructure/utils/yamlSanitizer
 */

/**
 * Sanitize a string for safe YAML serialization
 * - Removes control characters and problematic unicode
 * - Normalizes unicode to NFC form
 *
 * @param {string|null|undefined} str - String to sanitize
 * @returns {string} Sanitized string safe for YAML
 */
export function sanitizeForYAML(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') return String(str);

  let sanitized = str.normalize('NFC');

  // Remove control characters except newline/tab
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, ' ');

  // Remove zero-width characters
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Recursively sanitize all string values in an object for YAML safety
 *
 * @param {Object|Array|string|*} obj - Object to sanitize
 * @returns {Object|Array|string|*} New object with sanitized strings
 */
export function sanitizeObjectForYAML(obj) {
  if (obj === null || obj === undefined) {
    return typeof obj === 'string' ? sanitizeForYAML(obj) : obj;
  }

  if (typeof obj === 'string') {
    return sanitizeForYAML(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObjectForYAML);
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[sanitizeForYAML(key)] = sanitizeObjectForYAML(value);
    }
    return result;
  }

  return obj;
}

/**
 * Safe read of YAML file with sanitization fallback
 * Wraps YAML parsing with error recovery for malformed content
 *
 * @param {Function} readFn - Function to read file content
 * @param {Function} parseFn - YAML parse function
 * @param {string} filePath - Path to YAML file
 * @returns {Object|null} Parsed object or null on error
 */
export function safeReadYaml(readFn, parseFn, filePath) {
  try {
    const content = readFn(filePath);
    if (!content || content.trim() === '') return null;
    return parseFn(content);
  } catch (error) {
    // Try to recover by sanitizing and re-parsing
    try {
      const content = readFn(filePath);
      const sanitized = sanitizeForYAML(content);
      return parseFn(sanitized);
    } catch {
      return null;
    }
  }
}

export default {
  sanitizeForYAML,
  sanitizeObjectForYAML,
  safeReadYaml
};
