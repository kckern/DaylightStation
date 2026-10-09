/** Scheduled morning-debrief workflow, independent of cron and transport wiring. */
export class DeliverScheduledMorningDebrief {
  constructor({ username, resolveConversationId, generateMorningDebrief, sendMorningDebrief,
    logger = console }) {
    Object.assign(this, { username, resolveConversationId, generateMorningDebrief,
      sendMorningDebrief, logger });
  }

  async execute() {
    let conversationId;
    try {
      conversationId = this.resolveConversationId(this.username);
    } catch (error) {
      this.logger.warn?.('journalist.scheduled_debrief.identity_failed', { error: error?.message });
    }

    const debrief = await this.generateMorningDebrief.execute({
      username: this.username,
      conversationId,
    });
    if (!debrief.success) {
      this.logger.info?.('journalist.scheduled_debrief.skipped', {
        username: this.username,
        reason: debrief.reason,
      });
      return debrief;
    }

    try {
      await this.sendMorningDebrief.execute({ conversationId, debrief });
      this.logger.info?.('journalist.scheduled_debrief.sent', {
        username: this.username,
        date: debrief.date,
      });
    } catch (error) {
      this.logger.warn?.('journalist.scheduled_debrief.send_failed', {
        username: this.username,
        error: error?.message,
      });
    }
    return debrief;
  }
}
