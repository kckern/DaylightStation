export class IEinkPanelStore {
  getPanel(_panelId) { throw new Error('IEinkPanelStore.getPanel must be implemented'); }
  getTelemetry() { throw new Error('IEinkPanelStore.getTelemetry must be implemented'); }
  saveTelemetry(_records) { throw new Error('IEinkPanelStore.saveTelemetry must be implemented'); }
}

export function isEinkPanelStore(value) {
  return value != null
    && typeof value.getPanel === 'function'
    && typeof value.getTelemetry === 'function'
    && typeof value.saveTelemetry === 'function';
}
