/**
 * Submit Voice Memo Use Case
 * @module journalist/application/usecases/SubmitVoiceMemo
 *
 * Audio recorded away from the chat (the phone app) enters the journal through
 * the same use case a Telegram voice message does. ProcessVoiceEntry accepts
 * the audio as a `{ buffer, mimeType }` pair in place of a Telegram file id, so
 * transcription, the transcript echo, the journal entry and the follow-up
 * question are all the existing path. This use case adds only the memo's
 * identity: one memo id is journaled once.
 */

/** The journal id a memo's entry is saved under. */
export const memoMessageId = (memoId) => `memo:${memoId}`;

// A phone clock may run a little ahead of this one.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
// The upload queue gives up long before this; anything older is a wrong clock.
const OLDEST_RECORDING_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The time a memo says it was recorded, if it can be believed.
 * @returns {{at: Date|null, ignored: string|null}}
 */
export function recordedTime(recordedAt, nowMs) {
  if (recordedAt === null || recordedAt === undefined) return { at: null, ignored: null };
  if (typeof recordedAt !== 'number' || !Number.isFinite(recordedAt) || recordedAt <= 0) {
    return { at: null, ignored: 'not_a_time' };
  }
  if (recordedAt > nowMs + CLOCK_SKEW_MS) return { at: null, ignored: 'in_the_future' };
  if (recordedAt < nowMs - OLDEST_RECORDING_MS) return { at: null, ignored: 'too_old' };
  return { at: new Date(recordedAt), ignored: null };
}

export class SubmitVoiceMemo {
  #processVoiceEntry;
  #journalEntryRepository;
  #clock;
  #logger;
  // Uploads being processed right now, so a retry that arrives before the
  // first attempt has reached the journal joins it and does not start a second.
  #inFlight = new Map();

  constructor({ processVoiceEntry, journalEntryRepository, clock = Date.now, logger = {} } = {}) {
    if (!processVoiceEntry) throw new Error('processVoiceEntry is required');
    if (!journalEntryRepository?.findById) throw new Error('journalEntryRepository is required');
    this.#processVoiceEntry = processVoiceEntry;
    this.#journalEntryRepository = journalEntryRepository;
    this.#clock = clock;
    this.#logger = logger;
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
   *   | {kind: 'empty_transcription', memoId: string}>}
   */
  async execute({ conversationId, username, memoId, audioBuffer, mimeType, recordedAt = null }) {
    const key = `${conversationId}|${memoId}`;
    const running = this.#inFlight.get(key);
    if (running) return running;

    const work = this.#run({ conversationId, username, memoId, audioBuffer, mimeType, recordedAt })
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, work);
    return work;
  }

  async #run({ conversationId, username, memoId, audioBuffer, mimeType, recordedAt }) {
    const messageId = memoMessageId(memoId);

    // The journal is the record of what was accepted. It survives a restart,
    // and it already holds a memo whose reply failed after the entry was saved.
    if (await this.#journalEntryRepository.findById(messageId, conversationId)) {
      return { kind: 'duplicate', memoId };
    }

    const result = await this.#processVoiceEntry.execute({
      chatId: conversationId,
      voiceFileId: { buffer: audioBuffer, mimeType },
      messageId,
      senderId: username,
      senderName: username,
      ...this.#entryTime({ username, memoId, recordedAt }),
    });

    if (result?.success === false) return { kind: 'empty_transcription', memoId };
    return { kind: 'accepted', memoId, transcriptionLength: String(result?.transcription ?? '').length };
  }

  /** The entry's time when the memo was recorded earlier; nothing when it is now. */
  #entryTime({ username, memoId, recordedAt }) {
    const { at, ignored } = recordedTime(recordedAt, this.#clock());
    if (ignored) this.#logger.info?.('journalist.memo.recordedAtIgnored', { memoId, username, reason: ignored });
    return at ? { timestamp: at } : {};
  }
}

export default SubmitVoiceMemo;
