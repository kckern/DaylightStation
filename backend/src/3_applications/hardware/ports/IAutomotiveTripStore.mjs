/** Durable, retry-safe storage boundary for complete automotive trips. */
export class IAutomotiveTripStore {
  inspect(_vehicleId, _trip, _timezone) { throw new Error('inspect not implemented'); }
  save(_vehicleId, _trip, _timezone) { throw new Error('save not implemented'); }
}

export default IAutomotiveTripStore;
