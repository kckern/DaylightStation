/**
 * Show Date Selection Use Case
 * @module nutribot/usecases/ShowDateSelection
 *
 * Shows the date selection menu for adjusting items from different days.
 */

/**
 * Show date selection use case
 */
export class ShowDateSelection {
  #messagingGateway;
  #conversationStateStore;
  #logger;
  #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId } = input;

    this.#logger.debug?.('adjustment.showDateSelection', { userId, messageId });

    try {
      // 1. Get state to preserve originMessageId
      let originMessageId = messageId;
      if (this.#conversationStateStore?.get) {
        const state = await this.#conversationStateStore.get(conversationId);
        originMessageId = state?.flowState?.originMessageId || messageId;
      }

      // 2. Update state
      if (this.#conversationStateStore?.update) {
        await this.#conversationStateStore.update(conversationId, {
          activeFlow: 'adjustment',
          flowState: {
            step: 'date_selection',
            level: 0,
            originMessageId,
          },
        });
      }

      // 3. Build date selection keyboard
      const keyboard = this.#buildDateKeyboard();

      // 4. Update message
      await this.#messagingGateway.updateMessage(conversationId, originMessageId, {
        caption: '📅 <b>Review & Adjust</b>\n\nSelect a date to review:',
        parseMode: 'HTML',
        choices: keyboard,
      });

      this.#logger.info?.('adjustment.dateSelectionShown', { userId, messageId: originMessageId });

      return { success: true };
    } catch (error) {
      this.#logger.error?.('adjustment.showDateSelection.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Build date selection keyboard
   * @private
   */
  #buildDateKeyboard() {
    const keyboard = [];
    const today = new Date();

    // First row: Today and Yesterday
    keyboard.push([
      { text: '☀️ Today', callback_data: this.#encodeCallback('dt', { d: 0 }) },
      { text: '📆 Yesterday', callback_data: this.#encodeCallback('dt', { d: 1 }) },
    ]);

    // Second row: 2-4 days ago
    const row2 = [];
    for (let i = 2; i <= 4; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row2.push({ text: `${dayName}`, callback_data: this.#encodeCallback('dt', { d: i }) });
    }
    keyboard.push(row2);

    // Third row: 5-7 days ago
    const row3 = [];
    for (let i = 5; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      row3.push({ text: `${dayName}`, callback_data: this.#encodeCallback('dt', { d: i }) });
    }
    keyboard.push(row3);

    // Done button
    keyboard.push([{ text: '↩️ Done', callback_data: this.#encodeCallback('dn') }]);

    return keyboard;
  }
}

export default ShowDateSelection;
