export class IDeviceConfiguration {
  householdDevices(_householdId) { throw new Error('IDeviceConfiguration.householdDevices must be implemented'); }
  device(_deviceId) { throw new Error('IDeviceConfiguration.device must be implemented'); }
  piano() { throw new Error('IDeviceConfiguration.piano must be implemented'); }
}
