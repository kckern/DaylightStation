import { IEinkPanelStore } from '#apps/eink/ports/IEinkPanelStore.mjs';

const TELEMETRY_ADDRESS = 'hardware/eink/telemetry';

/** Owns the legacy household YAML addresses and missing-file behavior. */
export class DataServiceEinkPanelStore extends IEinkPanelStore {
  #household;
  constructor({ dataService }) {
    super();
    if (!dataService?.household) throw new Error('DataServiceEinkPanelStore requires dataService');
    this.#household = dataService.household;
  }
  getPanel(panelId) {
    try { return this.#household.read(`screens/${panelId}`) || null; }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }
  getTelemetry() {
    try {
      const records = this.#household.read(TELEMETRY_ADDRESS);
      return records && typeof records === 'object' ? records : {};
    } catch { return {}; }
  }
  saveTelemetry(records) { this.#household.write(TELEMETRY_ADDRESS, records); }
}

export default DataServiceEinkPanelStore;
