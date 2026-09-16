/**
 * PlaybackSessionRegistry — the open sessions, one per surface.
 *
 * Playback reaches the backend as a stream of progress pings with no "started"
 * and no "stopped" marker (four scattered `play/log` call sites, none of which
 * opens anything). The lifecycle therefore has to be DERIVED, and this is where
 * the derivation keeps its state.
 *
 * ONE SESSION PER SURFACE, always. A screen cannot be playing two things, so a
 * ping for different content supersedes: the previous session is handed back to
 * the caller to be closed. Without that, a child switching stories would leave
 * the first session open until the reaper caught it — two things "playing" on
 * one screen.
 *
 * In memory on purpose. A session is live state, meaningless after a restart:
 * if the process dies mid-play the remote's own timeout is the backstop, and
 * persisting would only resurrect sessions for content nobody is watching.
 */

import { PlaybackSession } from '#domains/media/entities/PlaybackSession.mjs';

export class PlaybackSessionRegistry {
  /** @type {Map<string, PlaybackSession>} surfaceId -> session */
  #bySurface = new Map();

  /**
   * Record a progress report, deriving the lifecycle.
   *
   * @param {{surfaceId: string, contentId: string, positionMs?: number, durationMs?: number, at: number}} report
   * @returns {{session: PlaybackSession, opened: boolean, superseded: PlaybackSession|null}}
   */
  record({ surfaceId, contentId, positionMs = 0, durationMs = 0, at }) {
    const existing = this.#bySurface.get(surfaceId);

    if (existing && existing.contentId === contentId && !existing.isStopped) {
      existing.advance({ positionMs, durationMs, at });
      return { session: existing, opened: false, superseded: null };
    }

    // Different content (or the old one already stopped) — supersede it.
    const superseded = existing && !existing.isStopped ? existing.stop({ at }) : null;
    const session = PlaybackSession.start({ surfaceId, contentId, positionMs, durationMs, at });
    this.#bySurface.set(surfaceId, session);
    return { session, opened: true, superseded };
  }

  /** The open session on a surface, if any. */
  get(surfaceId) {
    const session = this.#bySurface.get(surfaceId);
    return session && !session.isStopped ? session : null;
  }

  /** Close and forget a surface's session. Returns it, or null if none was open. */
  close({ surfaceId, at }) {
    const session = this.#bySurface.get(surfaceId);
    if (!session || session.isStopped) {
      this.#bySurface.delete(surfaceId);
      return null;
    }
    session.stop({ at });
    this.#bySurface.delete(surfaceId);
    return session;
  }

  /** Every session still alive — what a keepalive timer iterates. */
  live() {
    return [...this.#bySurface.values()].filter((s) => !s.isStopped);
  }

  /**
   * Sessions that have gone quiet. Removed from the registry and returned so the
   * caller can tell the remote they ended — a surface that crashes mid-play
   * never sends a stop, and the remote would otherwise show it playing forever.
   */
  reapStale({ now, ttlMs }) {
    const reaped = [];
    for (const [surfaceId, session] of this.#bySurface.entries()) {
      if (session.isStopped) { this.#bySurface.delete(surfaceId); continue; }
      if (session.isStale({ now, ttlMs })) {
        session.stop({ at: now });
        this.#bySurface.delete(surfaceId);
        reaped.push(session);
      }
    }
    return reaped;
  }

  get size() { return this.#bySurface.size; }
}

export default PlaybackSessionRegistry;
