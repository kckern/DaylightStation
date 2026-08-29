export class PressureMatOperations {
  constructor({ pressureMats }) { this.pressureMats = pressureMats; }
  list() { return this.pressureMats.listStatus(); }
  read(id) { return this.pressureMats.getStatus(id); }
  readDevice(id) { return this.pressureMats.fetchDeviceStatus(id); }
  recalibrate(id) { return this.pressureMats.recalibrate(id); }
  configureThreshold(id, threshold) { return this.pressureMats.setThreshold(id, threshold); }
  reboot(id) { return this.pressureMats.reboot(id); }
}
