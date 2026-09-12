import { IPlaySpeaker } from '#apps/gaming/ports/IPlaySpeaker.mjs';

/** Speaks through the kiosk's text-to-speech, which is audible over a game. */
export class KioskPlaySpeaker extends IPlaySpeaker {
  #clients; #logger;

  constructor({ clientsByDevice, logger = console }) {
    super();
    this.#clients = clientsByDevice || new Map();
    this.#logger = logger;
  }

  async say(deviceId, text) {
    const client = this.#clients.get(deviceId);
    if (!client?.command || !text) return false;
    try {
      const result = await client.command('textToSpeech', { text });
      return result?.ok !== false;
    } catch (error) {
      // Never let a failed announcement block the warning or the expiry.
      this.#logger.warn?.('play.speak.failed', { deviceId, error: error.message });
      return false;
    }
  }
}

export default KioskPlaySpeaker;
