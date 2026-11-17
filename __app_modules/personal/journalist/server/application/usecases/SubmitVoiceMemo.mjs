/**
 * Submit Voice Memo Use Case
 * @module journalist/application/usecases/SubmitVoiceMemo
 *
 * Audio recorded away from the chat (the phone app) enters the journal through
 * the steps a Telegram voice message takes: ProcessVoiceEntry transcribes the
 * audio (it accepts a `{ buffer, mimeType }` pair in place of a Telegram file
 * id) and echoes the transcript, ProcessTextEntry saves the entry and asks the
 * follow-up question.
 *
 * The order differs from a Telegram voice message in one way. A memo comes
 * from a client that retries, so its entry is saved as soon as the transcript
 * exists, before anything is sent, and each reply is noted in the memo ledger
 * when it has gone out. A retry then finds the saved entry, does not
 * transcribe again, and sends only the replies that never went.
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
  #processTextEntry;
  #journalEntryRepository;
  #memoLedger;
  #clock;
  #logger;
  // Uploads being processed right now, so a retry that arrives while the
  // first attempt is still running joins it and does not start a second.
  #inFlight = new Map();

  constructor({ processVoiceEntry, processTextEntry, journalEntryRepository, memoLedger, clock = Date.now, logger = {} } = {}) {
    if (!processVoiceEntry) throw new Error('processVoiceEntry is required');
    if (!processTextEntry) throw new Error('processTextEntry is required');
    if (!journalEntryRepository?.findById) throw new Error('journalEntryRepository is required');
    if (!memoLedger) throw new Error('memoLedger is required');
    this.#processVoiceEntry = processVoiceEntry;
    this.#processTextEntry = processTextEntry;
    this.#journalEntryRepository = journalEntryRepository;
    this.#memoLedger = memoLedger;
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
   *   | {kind: 'resumed', memoId: string}
   *   | {kind: 'empty_transcription', memoId: string}>}
   *   `resumed`: the entry was already journaled and this call sent the
   *   replies an earlier attempt did not.
   */
  async execute(input) {
    const key = `${input.username}|${input.memoId}`;
    const running = this.#inFlight.get(key);
    if (running) return running;

    const work = this.#run(input).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, work);
    return work;
  }

  async #run({ conversationId, username, memoId, audioBuffer, mimeType, recordedAt = null }) {
    const messageId = memoMessageId(memoId);
    const entry = { chatId: conversationId, messageId, senderId: username, senderName: username };

    const record = this.#memoLedger.record(username, memoId);
    if (record?.outcome === 'empty') return { kind: 'empty_transcription', memoId };

    // The journal is the record of what was accepted; the ledger says whether
    // the replies went out. An entry with no ledger record is a finished memo.
    const journaled = await this.#journalEntryRepository.findById(messageId, conversationId);
    if (journaled && (!record || (record.echoSent && record.followUpSent))) {
      return { kind: 'duplicate', memoId };
    }

    // Which replies have gone out. Only a journaled memo can have sent any.
    const sent = journaled ? record : {};
    let text;
    if (journaled) {
      text = String(journaled.content ?? journaled.text ?? '');
    } else {
      this.#memoLedger.mark(username, memoId, { saved: false });
      text = await this.#processVoiceEntry.transcribe({
        chatId: conversationId,
        voiceFileId: { buffer: audioBuffer, mimeType },
      });

      if (!text || text.trim().length === 0) {
        // Noted first, so a retry of the same silence is not transcribed again.
        this.#memoLedger.mark(username, memoId, { outcome: 'empty' });
        try {
          await this.#processVoiceEntry.sendNotUnderstood({ chatId: conversationId });
        } catch (error) {
          this.#logger.warn?.('journalist.memo.apologyFailed', { memoId, username, error: error?.message });
        }
        return { kind: 'empty_transcription', memoId };
      }

      await this.#processTextEntry.saveUserMessage({
        ...entry, text, ...this.#entryTime({ username, memoId, recordedAt }),
      });
      this.#memoLedger.mark(username, memoId, { saved: true, echoSent: false, followUpSent: false });
    }

    if (!sent.echoSent) {
      await this.#processVoiceEntry.sendTranscription({ chatId: conversationId, transcription: text });
      this.#memoLedger.mark(username, memoId, { echoSent: true });
    }

    if (!sent.followUpSent) {
      await this.#processTextEntry.execute({ ...entry, text, userMessageSaved: true });
      this.#memoLedger.mark(username, memoId, { followUpSent: true });
    }

    return journaled
      ? { kind: 'resumed', memoId }
      : { kind: 'accepted', memoId, transcriptionLength: text.length };
  }

  /** The entry's time when the memo was recorded earlier; nothing when it is now. */
  #entryTime({ username, memoId, recordedAt }) {
    const { at, ignored } = recordedTime(recordedAt, this.#clock());
    if (ignored) this.#logger.info?.('journalist.memo.recordedAtIgnored', { memoId, username, reason: ignored });
    return at ? { timestamp: at } : {};
  }
}

export default SubmitVoiceMemo;
