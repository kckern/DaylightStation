/**
 * Supplies redacted observation windows, station sightings and identified non-HTTP callers.
 * Each row is scoped to [since, until), except windows may straddle its boundaries.
 */
export class IRequestObservationSource {
  async read(_interval) {
    throw new Error('IRequestObservationSource.read must be implemented');
  }
}
