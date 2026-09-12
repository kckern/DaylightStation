/**
 * Makes the room with the identity reader ready for someone to walk into.
 *
 * The household's reader is not beside the screen a child plays on, so asking
 * them to authorise means waking a display in another room, showing them what to
 * do, and putting it back afterwards. That choreography is infrastructure; this
 * is the seam.
 *
 * `release` must be safe to call even if `raise` failed or was never called, so
 * the caller can always put the room back without tracking what it did.
 */
export class IReaderPresence {
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async raise(_prompt) { throw new Error('IReaderPresence.raise must be implemented'); }
  async release() { throw new Error('IReaderPresence.release must be implemented'); }
}
