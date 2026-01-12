/**
 * MessageSplitter Domain Service
 * @module journalist/domain/services/MessageSplitter
 *
 * Splits long messages for Telegram delivery.
 */

/**
 * Telegram message limit
 */
const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Safe buffer for headers and formatting
 */
const HEADER_BUFFER = 100;

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

/**
 * Split text into chunks at natural boundaries
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum length per chunk
 * @returns {string[]} - Array of text chunks
 */
function splitAtBoundaries(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text ? [text] : [];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const splitPoint = findBestSplitPoint(remaining, maxLength);
    chunks.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  return chunks;
}

/**
 * Split a transcription into numbered message parts
 * @param {string} transcription - The voice transcription text
 * @returns {string[]} - Array of formatted message parts
 */
export function splitTranscription(transcription) {
  const header = '🎙️ Transcription';
  const effectiveMax = TELEGRAM_MAX_LENGTH - HEADER_BUFFER;

  // Check if splitting is needed
  const fullMessage = `${header}:\n\n${transcription}`;
  if (fullMessage.length <= TELEGRAM_MAX_LENGTH) {
    return [fullMessage];
  }

  // Split the transcription text
  const chunks = splitAtBoundaries(transcription, effectiveMax);
  const total = chunks.length;

  // Format each chunk with numbered header
  return chunks.map((chunk, index) => {
    const partNumber = index + 1;
    return `${header} (${partNumber}/${total}):\n\n${chunk}`;
  });
}

/**
 * Check if text needs splitting
 * @param {string} text - Text to check
 * @param {number} [limit=4096] - Character limit
 * @returns {boolean}
 */
export function needsSplitting(text, limit = TELEGRAM_MAX_LENGTH) {
  return text.length > limit;
}

/**
 * Get the maximum safe message length
 * @returns {number}
 */
export function getMaxMessageLength() {
  return TELEGRAM_MAX_LENGTH;
}

export default {
  splitTranscription,
  needsSplitting,
  getMaxMessageLength,
};
