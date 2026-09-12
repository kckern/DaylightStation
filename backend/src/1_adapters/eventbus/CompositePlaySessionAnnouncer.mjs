import { IPlaySessionAnnouncer } from '#apps/gaming/ports/IPlaySessionAnnouncer.mjs';

/**
 * Fans one play-session fact out to several announcers.
 *
 * The domain events and the fleet projection are different audiences with
 * different shapes, and neither should have to know the other exists. One
 * announcer failing must never stop the rest — announcing is best-effort by
 * contract, because losing a broadcast is a visibility problem whereas losing
 * the session would be a money problem.
 */
export class CompositePlaySessionAnnouncer extends IPlaySessionAnnouncer {
  #announcers; #logger;

  constructor({ announcers = [], logger = console }) {
    super();
    this.#announcers = announcers.filter(Boolean);
    this.#logger = logger;
  }

  async started(session) { await this.#each('started', session); }
  async progress(session, observation) { await this.#each('progress', session, observation); }
  async ended(session) { await this.#each('ended', session); }

  async #each(kind, session, observation) {
    for (const announcer of this.#announcers) {
      try {
        await announcer[kind]?.(session, observation);
      } catch (error) {
        this.#logger.warn?.('play.announce.member_failed', {
          kind, sessionId: session?.id, error: error.message,
        });
      }
    }
  }
}

export default CompositePlaySessionAnnouncer;
