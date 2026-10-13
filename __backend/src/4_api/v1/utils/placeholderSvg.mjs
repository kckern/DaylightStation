/**
 * Placeholder SVG Generator
 *
 * Generates a lightweight SVG image with a type badge and title text.
 * Used as a fallback for non-displayable content (programs, playlists, etc.)
 * that lack thumbnail images.
 *
 * @module api/v1/utils/placeholderSvg
 */

const BADGE_COLORS = {
  program:   '#4a90d9',
  watchlist:  '#d9a04a',
  list:       '#d9a04a',
  talk:       '#6b8e4e',
  scripture:  '#8b6e4e',
  hymn:       '#7e5a9b',
  primary:    '#9b5a7e',
  poem:       '#5a7e9b',
  plex:       '#e5a00d',
  immich:     '#4e8e6b',
  default:    '#777'
};

/**
 * Truncate text to a max length, adding ellipsis if needed.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max = 32) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

/**
 * Escape XML special characters for safe SVG embedding.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a placeholder SVG with a type badge and title.
 *
 * @param {Object} opts
 * @param {string} opts.type - Content source type (program, talk, etc.)
 * @param {string} [opts.title] - Item title to display
 * @param {number} [opts.size=300] - SVG square dimension
 * @returns {string} SVG markup
 */
export function generatePlaceholderSvg({ type, title, size = 300 }) {
  const badgeColor = BADGE_COLORS[type] || BADGE_COLORS.default;
  const badgeLabel = escapeXml((type || 'content').toUpperCase());
  const titleText = escapeXml(truncate(title || '', 40));

  const contentWidth = size * 0.85;
  const badgeWidth = Math.min(contentWidth, Math.max(80, badgeLabel.length * 12 + 24));
  const badgeX = (size - badgeWidth) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1a1a"/>
  <rect x="${badgeX}" y="${size * 0.38}" width="${badgeWidth}" height="28" rx="4" fill="${badgeColor}"/>
  <text x="${size / 2}" y="${size * 0.38 + 19}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#fff" letter-spacing="1">${badgeLabel}</text>
  ${titleText ? `<text x="${size / 2}" y="${size * 0.58}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#ccc">${titleText}</text>` : ''}
</svg>`;
}
