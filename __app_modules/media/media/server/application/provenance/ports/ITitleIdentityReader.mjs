/**
 * Port for provenance (which streaming service a title is "from").
 * Reference: __docs/reference/media/provenance.md
 */

/** Says what a household title is, in external ids. */
export class ITitleIdentityReader {
  /**
   * @param {string} _ratingKey - Plex rating key (digits)
   * @returns {Promise<{ key:string, kind:'movie'|'show', title:string|null, year:number|null, imdb:string|null, tmdb:string|null,
   *   studio:string|null, durationMs:number|null, collections:string[], labels:string[], library:string|null }|null>}
   *   `key` is the rating key availability is recorded under: the item itself for a
   *   movie or show, the show for an episode or season. Null for anything else.
   */
  async identify(_ratingKey) { throw new Error('ITitleIdentityReader.identify not implemented'); }
}
