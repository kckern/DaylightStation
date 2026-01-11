/**
 * MessageSplitter Domain Service
 * @module journalist/domain/services/MessageSplitter
 *
 * Splits long messages for Telegram delivery.
 */

import { splitAtBoundaries } from '../../../../_lib/utils/text.mjs';

/**
 * Telegram message limit
 */
const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Safe buffer for headers and formatting
 */
const HEADER_BUFFER = 100;

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
