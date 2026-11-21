/**
 * Journal quick inputs
 * @module journalist/application/services/journalInputs
 *
 * What the Journalist does with an input captured away from the chat: the
 * kind handlers it plugs into the shared quick-input intake. Each one joins
 * the steps a Telegram message of that kind takes. ProcessVoiceEntry
 * transcribes the audio (it accepts a `{ buffer, mimeType }` pair in place of
 * a Telegram file id) and echoes the transcript; ProcessTextEntry saves the
 * entry and asks the follow-up question.
 *
 * The order differs from a Telegram message in one way. A quick input comes
 * from a client that retries, so its entry is saved before anything is sent,
 * and the intake notes each reply when it has gone. A retry then finds the
 * saved entry and sends only the replies that never went.
 */

/** The journal id a voice memo's entry is saved under. */
export const memoMessageId = (memoId) => `memo:${memoId}`;
/** The journal id a typed note's entry is saved under. */
export const noteMessageId = (inputId) => `note:${inputId}`;

const entryOf = (input, messageId) => ({
  chatId: input.conversationId, messageId, senderId: input.username, senderName: input.username,
});
const stored = (journaled) => (journaled ? { text: String(journaled.content ?? journaled.text ?? '') } : null);
const dated = (input) => (input.capturedAt ? { timestamp: input.capturedAt } : {});

/**
 * A spoken journal entry: transcribe, save, echo the transcript, ask the follow-up.
 * @param {Object} deps
 * @param {Object} deps.processVoiceEntry
 * @param {Object} deps.processTextEntry
 * @param {Object} deps.journalEntryRepository
 */
export function journalVoiceHandler({ processVoiceEntry, processTextEntry, journalEntryRepository }) {
  const entry = (input) => entryOf(input, memoMessageId(input.inputId));
  return {
    storedReceipt: input => ({ entryId: memoMessageId(input.inputId) }),
    lookup: async (input) => stored(await journalEntryRepository.findById(memoMessageId(input.inputId), input.conversationId)),

    process: async (input) => {
      const text = await processVoiceEntry.transcribe({
        chatId: input.conversationId,
        voiceFileId: { buffer: input.body, mimeType: input.mimeType },
      });
      if (!text || text.trim().length === 0) {
        return {
          nothing: 'empty_transcription',
          notify: () => processVoiceEntry.sendNotUnderstood({ chatId: input.conversationId }),
        };
      }
      await processTextEntry.saveUserMessage({ ...entry(input), text, ...dated(input) });
      return { state: { text }, summary: { transcriptionLength: text.length } };
    },

    replies: [
      { step: 'echo', send: (input, { text }) => processVoiceEntry.sendTranscription({ chatId: input.conversationId, transcription: text }) },
      { step: 'followUp', send: (input, { text }) => processTextEntry.execute({ ...entry(input), text, userMessageSaved: true }) },
    ],
  };
}

/**
 * A typed journal entry: save, ask the follow-up. A Telegram text message
 * gets no echo, and neither does this.
 * @param {Object} deps
 * @param {Object} deps.processTextEntry
 * @param {Object} deps.journalEntryRepository
 */
export function journalTextHandler({ processTextEntry, journalEntryRepository }) {
  const entry = (input) => entryOf(input, noteMessageId(input.inputId));
  return {
    storedReceipt: input => ({ entryId: noteMessageId(input.inputId) }),
    lookup: async (input) => stored(await journalEntryRepository.findById(noteMessageId(input.inputId), input.conversationId)),

    process: async (input) => {
      const text = input.body.toString('utf8').trim();
      await processTextEntry.saveUserMessage({ ...entry(input), text, ...dated(input) });
      return { state: { text } };
    },

    replies: [
      { step: 'followUp', send: (input, { text }) => processTextEntry.execute({ ...entry(input), text, userMessageSaved: true }) },
    ],
  };
}
