export class IDevicePresenceStore {
  record(_deviceId, _report) { throw new Error('IDevicePresenceStore.record must be implemented'); }
  get(_deviceId) { throw new Error('IDevicePresenceStore.get must be implemented'); }
  history(_deviceId) { throw new Error('IDevicePresenceStore.history must be implemented'); }
}
