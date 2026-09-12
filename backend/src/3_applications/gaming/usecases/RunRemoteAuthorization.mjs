/**
 * Walks a child through authorising play at a reader in another room.
 *
 * Wake the room, ask, put the room back. The last step is the one that is easy
 * to forget and embarrassing to leave undone — a screen left glowing in an empty
 * garage — so it runs in a finally, whether the scan succeeded, failed, or
 * nobody ever came.
 *
 * A failure to wake the room is NOT a refusal. The child has not declined
 * anything; we simply could not set up the question, and saying "denied" would
 * blame them for our own infrastructure. The ceremony still attempts the scan in
 * case the room was already usable.
 */
export class RunRemoteAuthorization {
  #presence; #authorize; #logger;

  constructor({ presence, authorizePlay, logger = console }) {
    if (!authorizePlay?.execute) throw new Error('RunRemoteAuthorization requires authorizePlay');
    this.#presence = presence || null;
    this.#authorize = authorizePlay;
    this.#logger = logger;
  }

  /**
   * @param {Object} input  Passed through to the authorisation, plus `prompt`.
   * @returns {Promise<{authorized: boolean, userId: string|null, reason: string|null, intent: object|null}>}
   */
  async execute({ prompt = null, ...request }) {
    let raised = false;
    try {
      if (this.#presence?.raise) {
        const result = await this.#presence.raise(
          prompt || `Scan to play ${request.content?.title || 'a game'}`,
        );
        raised = result?.ok === true;
        if (!raised) {
          this.#logger.warn?.('play.authorize.room_not_ready', { error: result?.error });
        }
      }
      return await this.#authorize.execute(request);
    } catch (error) {
      this.#logger.warn?.('play.authorize.ceremony_failed', { error: error.message });
      return { authorized: false, userId: null, reason: 'unavailable', intent: null };
    } finally {
      // Always put the room back, even if we never woke it.
      try { await this.#presence?.release?.(); } catch (error) {
        this.#logger.warn?.('play.authorize.room_release_failed', { error: error.message });
      }
    }
  }
}

export default RunRemoteAuthorization;
