/**
 * PlexSourceProbe — asks Plex whether it can read a media item's files.
 *
 * `GET /library/metadata/{id}?checkFiles=1` makes Plex stat every part and
 * report `exists` / `accessible` on each. On 2026-09-28 the answer for a file
 * the NAS had zeroed was `exists: true, accessible: false`, while every direct
 * play of it returned 404. The same call is also the cheapest remediation rung:
 * it refreshes Plex's own accessibility flag.
 */

import { classifyPlexParts, SOURCE_STATE } from '#domains/media/sourceHealth.mjs';

export class PlexSourceProbe {
  #client;

  /** @param {{ client: { request(path: string, opts?: Object): Promise<Object> } }} deps */
  constructor({ client }) {
    if (!client?.request) throw new Error('PlexSourceProbe requires a Plex client');
    this.#client = client;
  }

  /**
   * @param {string} ratingKey
   * @returns {Promise<{state: string, path: string|null, title: string|null, showTitle: string|null}>}
   */
  async probe(ratingKey) {
    const data = await this.#client.request(`/library/metadata/${ratingKey}?checkFiles=1`, { deadline: 15_000 });
    const item = data?.MediaContainer?.Metadata?.[0];
    if (!item) return { state: SOURCE_STATE.unknown, path: null, title: null, showTitle: null };
    const parts = (item.Media || []).flatMap((media) => media?.Part || []);
    const { state, part } = classifyPlexParts(parts);
    const answer = {
      state,
      path: part?.file ?? null,
      title: item.title ?? null,
      showTitle: item.grandparentTitle ?? item.parentTitle ?? null,
    };
    if (state !== SOURCE_STATE.readable) return answer;

    // checkFiles is Plex STATTING the file. On 2026-09-29 it said accessible
    // while every direct play of the part answered 404 (mid library scan), and
    // the Player skipped the episode. Ask for one byte of the part itself.
    const partStatus = await this.#partStatus(part?.key);
    if (partStatus === 403 || partStatus === 404) {
      return { ...answer, state: SOURCE_STATE.unreadable, reason: 'part-refused', partStatus };
    }
    return answer;
  }

  /** HTTP status for one byte of the part, or null when it cannot be asked. */
  async #partStatus(partKey) {
    if (!partKey || typeof this.#client.partStatus !== 'function') return null;
    try {
      return await this.#client.partStatus(partKey);
    } catch {
      return null; // a failed extra request never escalates on its own
    }
  }
}

export default PlexSourceProbe;
