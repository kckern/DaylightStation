/**
 * Creates a root-bound policy for deciding whether a concrete storage
 * location belongs to the health archive read surface.
 */
export class IHealthArchiveAddressPolicyFactory {
  create(_roots) {
    throw new Error('IHealthArchiveAddressPolicyFactory.create must be implemented');
  }
}
