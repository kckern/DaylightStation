/**
 * Port for provenance (which streaming service a title is "from").
 * Reference: __docs/reference/media/provenance.md
 */

/** Looks up where a title streams. */
export class IStreamingAvailabilityGateway {
  /**
   * @param {string} _lookupId - IMDb id (`tt…`) or typed TMDB id (`movie-603`, `tv-1396`)
   * @returns {Promise<{ sources: Array<{name:string,type:string,url:string|null}>, quota: number|null, quotaUsed: number|null }>}
   *   `sources` is empty when the title is unknown to the service.
   */
  async sources(_lookupId) { throw new Error('IStreamingAvailabilityGateway.sources not implemented'); }
}
