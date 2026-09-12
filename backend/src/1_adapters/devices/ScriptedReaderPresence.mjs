import { IReaderPresence } from '#apps/gaming/ports/IReaderPresence.mjs';

/**
 * Wakes the room holding the identity reader by running configured home-
 * automation scripts, and puts it back afterwards.
 *
 * Which scripts, and whether there are any, is CONFIGURATION. A household whose
 * reader sits on an always-on screen configures none and the ceremony simply
 * asks without waking anything — absence is a valid setup, not a broken one.
 *
 * Both calls report rather than throw. Waking the room is a convenience around
 * the actual question; failing at it must never masquerade as the person having
 * refused.
 */
export class ScriptedReaderPresence extends IReaderPresence {
  #gateway; #raiseScript; #releaseScript; #speaker; #speakerDeviceId; #logger;

  constructor({
    haGateway, raiseScript = null, releaseScript = null,
    speaker = null, speakerDeviceId = null, logger = console,
  }) {
    super();
    this.#gateway = haGateway || null;
    this.#raiseScript = raiseScript;
    this.#releaseScript = releaseScript;
    this.#speaker = speaker;
    this.#speakerDeviceId = speakerDeviceId;
    this.#logger = logger;
  }

  async raise(prompt) {
    const woke = await this.#run(this.#raiseScript, 'raise');
    // Say why the screen just came on, so walking in is not a puzzle.
    if (prompt && this.#speaker?.say && this.#speakerDeviceId) {
      try { await this.#speaker.say(this.#speakerDeviceId, prompt); } catch { /* best effort */ }
    }
    return woke;
  }

  async release() { return this.#run(this.#releaseScript, 'release'); }

  async #run(script, what) {
    if (!script) return { ok: true };            // nothing configured: nothing to do
    if (!this.#gateway?.callService) {
      return { ok: false, error: 'no home-automation gateway configured' };
    }
    try {
      const [domain, service] = String(script).includes('.')
        ? String(script).split('.', 2)
        : ['script', script];
      await this.#gateway.callService(domain, service, {});
      return { ok: true };
    } catch (error) {
      this.#logger.warn?.(`play.reader.${what}_failed`, { script, error: error.message });
      return { ok: false, error: error.message };
    }
  }
}

export default ScriptedReaderPresence;
