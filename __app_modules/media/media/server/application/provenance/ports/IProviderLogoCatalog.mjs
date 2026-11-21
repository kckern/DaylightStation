/**
 * Port for provenance (which streaming service a title is "from").
 * Reference: __docs/reference/media/provenance.md
 */

/** Which provider ids have a logo to show. */
export class IProviderLogoCatalog {
  /** @returns {boolean} */
  has(_provider) { throw new Error('IProviderLogoCatalog.has not implemented'); }
}
