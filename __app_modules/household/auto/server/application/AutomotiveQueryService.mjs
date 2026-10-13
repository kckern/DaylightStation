/** Vehicle record queries spanning configured vehicles, history, and hand-authored records. */
export class AutomotiveQueryService {
  constructor({ container, summarizeFuel } = {}) {
    this.container = container;
    this.summarizeFuel = summarizeFuel;
  }

  async listVehicles() {
    const ids = await this.container.listVehicleIds();
    return Promise.all(ids.map(async (id) => {
      const record = await this.container.recordRepository.readVehicle(id);
      return { ...(record || {}), id, label: this.container.vehicleLabel(id, record) };
    }));
  }
  async overview(vehicleId) {
    const overview = await this.container.useCases.getVehicleOverview.execute({ vehicleId });
    return { ...overview, label: this.container.vehicleLabel(vehicleId, overview.vehicle) };
  }
  journeys(query) { return this.container.useCases.listJourneys.execute(query); }
  tripDetail(query) { return this.container.useCases.getTripDetail.execute(query); }
  events(vehicleId, query) { return this.container.historyRepository.listEvents(vehicleId, query); }
  async fuel(vehicleId) {
    const [logs, stops] = await Promise.all([
      this.container.recordRepository.listFuelLogs(vehicleId),
      this.container.useCases.getFuelStops.execute({
        vehicleId, tankCapacityL: this.container.tankCapacityL(vehicleId),
      }),
    ]);
    return { logs, summary: this.summarizeFuel(logs), detected: stops.unlogged };
  }
  serviceTypes() { return this.container.serviceTypes; }
  serviceRecords(vehicleId) { return this.container.recordRepository.listServiceRecords(vehicleId); }
  documents(vehicleId) { return this.container.recordRepository.listDocuments(vehicleId); }
  places() { return this.container.placeRepository.listPlaces(); }
}

export default AutomotiveQueryService;
