/** Hand-authored automotive record commands, including explicit deletions. */
export class AutomotiveCommandService {
  constructor({ container } = {}) { this.container = container; }
  logFuel(command) { return this.container.useCases.logFuel.execute(command); }
  deleteFuel(vehicleId, logId) { return this.container.recordRepository.deleteFuelLog(vehicleId, logId); }
  logService(command) { return this.container.useCases.logServiceRecord.execute(command); }
  deleteService(vehicleId, recordId) { return this.container.recordRepository.deleteServiceRecord(vehicleId, recordId); }
  namePlace(command) { return this.container.useCases.namePlace.execute(command); }
  deletePlace(placeId) { return this.container.placeRepository.deletePlace(placeId); }
}

export default AutomotiveCommandService;
