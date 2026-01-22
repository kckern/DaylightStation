/**
 * String utilities
 * @module infrastructure/utils/strings
 */

/**
 * Convert a string to URL-friendly slug
 * @param {string} text - Text to slugify
 * @returns {string} Slugified text
 *
 * @example
 * slugify('Hello World!')  // 'hello-world'
 * slugify('My Title Here') // 'my-title-here'
 */
export const slugify = (text) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
};
