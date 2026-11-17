/**
 * Submit Voice Memo Use Case
 * @module journalist/application/usecases/SubmitVoiceMemo
 *
 * A voice memo recorded away from the chat enters the journal once. This is
 * the shared quick-input intake with the Journalist's voice handler plugged
 * in (see ../services/journalInputs.mjs), under the names the memo intake was
 * built with: a memo id, a memo ledger, a daily allowance of memos.
 */

import { QuickInputIntake, recordedTime } from '../../../../../../__capabilities/quick-input/server/public.mjs';
import { journalVoiceHandler, memoMessageId } from '../services/journalInputs.mjs';

export { memoMessageId, recordedTime };

const inMemoTerms = ({ inputId, ...result }) => ({
  ...result,
  memoId: inputId,
  ...(result.limit === 'inputs' ? { limit: 'memos' } : {}),
});

export class SubmitVoiceMemo {
  #intake;

  constructor({ processVoiceEntry, processTextEntry, journalEntryRepository, memoLedger, clock = Date.now, logger = {} } = {}) {
    if (!processVoiceEntry) throw new Error('processVoiceEntry is required');
    if (!processTextEntry) throw new Error('processTextEntry is required');
    if (!journalEntryRepository?.findById) throw new Error('journalEntryRepository is required');
    if (!memoLedger) throw new Error('memoLedger is required');
    this.#intake = new QuickInputIntake({
      bot: 'journalist',
      kind: 'voice',
      handler: journalVoiceHandler({ processVoiceEntry, processTextEntry, journalEntryRepository }),
      ledger: memoLedger.ledger,
      clock,
      logger,
      events: 'journalist.memo',
      describe: ({ inputId, username }) => ({ memoId: inputId, username }),
    });
  }

  /** The shared intake, for a route that speaks in input ids. */
  get intake() { return this.#intake; }

  /**
   * Whether a memo of `bytes` would be sent for transcription today, asked
   * before the body is read.
   * @returns {{allowed: true} | {allowed: false, limit: 'memos'|'bytes', retryAfterSeconds: number}}
   */
  admission({ username, memoId, bytes = 0 }) {
    const admission = this.#intake.admission({ username, inputId: memoId, bytes });
    return admission.allowed ? admission : { ...admission, limit: admission.limit === 'inputs' ? 'memos' : admission.limit };
  }

  /**
   * @param {Object} input
   * @param {string} input.conversationId - The user's Journalist conversation
   * @param {string} input.username
   * @param {string} input.memoId - The client's id for this recording
   * @param {Buffer} input.audioBuffer
   * @param {string} input.mimeType
   * @param {number|null} [input.recordedAt] - Epoch ms the recording started
   * @returns {Promise<{kind: 'accepted', memoId: string, transcriptionLength: number}
   *   | {kind: 'duplicate', memoId: string}
   *   | {kind: 'resumed', memoId: string}
   *   | {kind: 'empty_transcription', memoId: string}
   *   | {kind: 'daily_limit', memoId: string, limit: 'memos'|'bytes', retryAfterSeconds: number}>}
   */
  async execute({ conversationId, username, memoId, audioBuffer, mimeType, recordedAt = null }) {
    return inMemoTerms(await this.#intake.execute({
      conversationId, username, inputId: memoId, body: audioBuffer, mimeType, recordedAt,
    }));
  }
}

export default SubmitVoiceMemo;
