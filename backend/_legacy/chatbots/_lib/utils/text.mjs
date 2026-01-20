/**
 * Text utilities
 * @module _lib/utils/text
 */

/**
 * Split text into chunks at natural boundaries
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum length per chunk
 * @param {Object} [options]
 * @param {number} [options.reservedSpace=0] - Space to reserve for headers/footers
 * @returns {string[]} - Array of text chunks
 */
export function splitAtBoundaries(text, maxLength, options = {}) {
  const { reservedSpace = 0 } = options;
  const effectiveMax = maxLength - reservedSpace;

  if (!text || text.length <= effectiveMax) {
    return text ? [text] : [];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= effectiveMax) {
      chunks.push(remaining);
      break;
    }

    const splitPoint = findBestSplitPoint(remaining, effectiveMax);
    chunks.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  return chunks;
}

/**
 * Find best split point preferring: paragraph > sentence > word > hard cut
 * @param {string} text - Text to find split point in
 * @param {number} maxLength - Maximum length for this chunk
 * @returns {number} - Best split index
 */
function findBestSplitPoint(text, maxLength) {
  const searchRange = text.slice(0, maxLength);

  // Try paragraph boundary (double newline)
  const paragraphMatch = searchRange.lastIndexOf('\n\n');
  if (paragraphMatch > maxLength * 0.5) {
    return paragraphMatch + 2;
  }

  // Try sentence boundary (. ! ?)
  const sentenceRegex = /[.!?]\s+/g;
  let lastSentenceEnd = -1;
  let match;
  while ((match = sentenceRegex.exec(searchRange)) !== null) {
    lastSentenceEnd = match.index + match[0].length;
  }
  if (lastSentenceEnd > maxLength * 0.3) {
    return lastSentenceEnd;
  }

  // Try word boundary
  const lastSpace = searchRange.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.5) {
    return lastSpace + 1;
  }

  // Fallback: hard cut
  return maxLength;
}
