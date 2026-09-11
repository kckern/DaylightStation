/**
 * IReadingSessionStore — the open reading sessions, across a restart.
 *
 * WHY THIS EXISTS. `ReadingSessionService` keeps its sessions in a plain Map in
 * the process. On 2026-09-11 a child started a 9m40s read-along and the backend
 * was redeployed four minutes in; when the story ended the server had never
 * heard of the session it was being told about and refused the read. From the
 * sofa that reads as the story not finishing, because the ending a child is
 * waiting for is the ceremony — the pip filling, the close screen — not the
 * audio.
 *
 * `ReadingApiService` now credits a finished book from the request's own
 * evidence, so the read itself is no longer lost. This port is the other half:
 * the SESSION survives too, so the room stays coherent — the TV knows what it
 * is showing, the pick is still attributable, teardown still happens, and the
 * child does not have to scan back in because a deploy landed.
 *
 * TRANSIENT STATE, NOT EVIDENCE. A reading log row is a durable fact about a
 * child's day; a session is what the living room is doing this minute. This
 * belongs in `runtime/`, beside the token registry and the review queue, and it
 * is fine for it to be wrong — a stale rehydrated session is torn down by the
 * same idle sweep that tears down a stale live one.
 *
 * NEVER THROWS. Both methods answer for themselves: `load` returns `[]` when
 * there is nothing on file or the file cannot be read, and `save` swallows its
 * own failures. Neither may take the living room down with it — a household
 * whose disk is full should lose session durability, not story time.
 *
 * @typedef {object} StoredReadingSession
 * @property {string} location the room, and the Map's key
 * @property {string} sessionId
 * @property {string|null} learnerId
 * @property {string} state
 */
export class IReadingSessionStore {
  /**
   * Every session that was open when the process last wrote.
   *
   * @returns {Promise<StoredReadingSession[]>} `[]` for absent or unreadable.
   */
  async load() {
    throw new Error('IReadingSessionStore.load must be implemented');
  }

  /**
   * Replace the stored set with this one. An empty array clears the file.
   *
   * @param {StoredReadingSession[]} sessions
   * @returns {Promise<void>}
   */
  async save(sessions) {
    throw new Error('IReadingSessionStore.save must be implemented');
  }
}

export default IReadingSessionStore;
