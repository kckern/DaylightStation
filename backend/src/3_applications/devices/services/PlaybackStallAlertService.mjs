/** Shapes and sends the household alert for a latched playback-stall episode. */
export class PlaybackStallAlertService {
  constructor({ notifier, logger = console }) {
    this.notifier = notifier;
    this.logger = logger;
  }

  notify({ deviceId, contentId, title, position, stalledForMs }) {
    const minutes = Math.max(1, Math.round(stalledForMs / 60_000));
    return this.notifier.send({
      title: 'A screen is stuck',
      body: `${deviceId} says it is playing ${title || contentId || 'something'} `
        + `but the playhead has not moved in ${minutes} minute${minutes === 1 ? '' : 's'} `
        + `(stuck at ${Math.round(position)}s). Someone is probably waiting in front of it.`,
      category: 'system',
      urgency: 'high',
      dedupeKey: `playback-stall:${deviceId}:${contentId || 'unknown'}`,
    }).catch((error) => this.logger.warn?.('playback-stall.notify-failed', { error: error.message }));
  }
}

export default PlaybackStallAlertService;
