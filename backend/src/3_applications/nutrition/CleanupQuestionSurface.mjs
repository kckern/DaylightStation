/** Optional Telegram projection. The shared interaction remains authoritative. */
export class CleanupQuestionSurface {
  #busy = new Set();
  constructor({ cleanup, destinationFor, gateway, logger }) { Object.assign(this, { cleanup, destinationFor, gateway, logger }); }
  async sync(userId) {
    if (this.#busy.has(userId)) return;
    this.#busy.add(userId);
    try {
      const state = this.cleanup.store.load(userId);
      const destination = this.destinationFor(userId);
      if (!state.settings.telegram || !destination || this.gateway.available === false) return;
      for (const q of Object.values(state.questions)) {
        const preview = q.choices.map(choice => choice.label + '\n' + [
          ...choice.repair.updates.map(update => (q.entryNames?.[update.id] || update.id) + ': ' + Object.entries(update.changes).map(([key, value]) => `${key} → ${value ?? 'none'}`).join(', ')),
          ...choice.repair.createGroups.map(group => `Group as ${group.label}`),
        ].join('\n')).join('\n\n');
        const fits = preview.length + q.question.length < 3200;
        const text = q.status === 'open'
          ? 'Food cleanup question\n' + q.question + '\n\n' + (fits ? preview + '\n\nChoose below, or reply to this message with your answer.' : 'Open Health to review the full proposed changes, or reply with a specific answer.')
          : 'Food cleanup: ' + q.status + '\n' + q.question + (q.outcome?.message ? '\n' + q.outcome.message : '');
        const choices = q.status === 'open'
          ? [...(fits ? q.choices.map(choice => [{ text: choice.label, callback_data: 'nc:' + q.id + ':' + choice.id }]) : []),
            [{ text: 'Leave unchanged', callback_data: 'nc:' + q.id + ':dismiss' }]] : [];
        if (!q.delivery && q.status === 'open') {
          // Telegram has no idempotent send. An ambiguous send is not retried:
          // Health remains usable and we avoid duplicate questions after a crash.
          this.cleanup.store.update(userId, s => { s.questions[q.id].delivery = { status: 'sending', destination }; });
          try {
            const sent = await this.gateway.sendMessage(destination, text, { choices, inline: true });
            this.cleanup.store.update(userId, s => { s.questions[q.id].delivery = {
              status: 'sent', destination, messageId: String(sent.messageId), version: q.version,
              chatId: destination.split('_c').at(-1),
            }; });
          } catch (error) {
            this.cleanup.store.update(userId, s => { s.questions[q.id].delivery.status = 'uncertain'; });
            this.logger.warn('nutrition.cleanup.question_delivery_uncertain', { userId, questionId: q.id, error: error.message });
          }
        } else if (q.delivery?.messageId && q.delivery.version !== q.version) {
          try {
            await this.gateway.updateMessage(q.delivery.destination, q.delivery.messageId, { text, choices, inline: true });
            this.cleanup.store.update(userId, s => { s.questions[q.id].delivery.version = q.version; });
          } catch (error) {
            const reason = error.response?.data?.description || error.message;
            if (/message is not modified|message.*not found|message can't be edited/i.test(reason)) {
              this.cleanup.store.update(userId, s => { s.questions[q.id].delivery.version = q.version; });
            } else this.logger.warn('nutrition.cleanup.question_update_retry', { userId, questionId: q.id, error: error.message });
          }
        }
      }
    } finally { this.#busy.delete(userId); }
  }
  async handle(userId, event, response) {
    const callback = event.payload?.callbackData;
    const match = typeof callback === 'string' ? /^nc:([a-z0-9]+):([a-z0-9]+)$/.exec(callback) : null;
    const replyId = event.metadata?.replyToMessageId;
    if (!match && !replyId) return false;
    const questions = this.cleanup.interactions.list(userId);
    const q = match ? questions.find(q => q.id === match[1]) : questions.find(q => q.delivery?.messageId === String(replyId));
    if (!q && !match) return false;
    if (!q || q.delivery?.chatId !== String(event.metadata?.chatId)
      || q.delivery.chatId !== String(event.metadata?.senderId)) {
      await response?.sendMessage?.('That cleanup question is unavailable here.');
      return true;
    }
    if (q.status !== 'open' && q.status !== 'answering') {
      await response?.sendMessage?.('This question is already ' + q.status + '.');
      return true;
    }
    const text = event.payload?.text;
    if (!match && !text) { await response?.sendMessage?.('Please type your answer in a reply to the question.'); return true; }
    try {
      await this.cleanup.interactions.answer({ userId, id: q.id, expectedVersion: q.version,
        operationId: 'telegram_' + String(event.payload?.callbackId || event.messageId).replace(/[^a-zA-Z0-9_-]/g, ''),
        choiceId: match && match[2] !== 'dismiss' ? match[2] : undefined,
        dismiss: match?.[2] === 'dismiss', text: match ? undefined : text });
      await this.sync(userId);
    } catch (error) {
      await response?.sendMessage?.(error.status === 409 ? error.message : 'Your answer could not finish yet. You can review its status in Health.');
      if (![400, 404, 409].includes(error.status)) throw error;
    }
    return true;
  }
}
