import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { schoolCalcDeviceView } from './deviceView.mjs';

/** Decode family bytes through the registered adapter and persist observation. */
export class ObserveSchoolCalcDevice {
  #devices; #codecs; #clock;

  constructor({ devices, codecs, clock = () => new Date() } = {}) {
    if (!devices || !codecs) throw new Error('ObserveSchoolCalcDevice requires devices and codecs');
    this.#devices = devices;
    this.#codecs = codecs;
    this.#clock = clock;
  }

  async execute({ deviceId, rawInfo, rawState = null, relayId } = {}) {
    const current = await this.#devices.getDevice(deviceId);
    if (!current) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    const codec = this.#codecs.get(current.platformId);
    const capabilityReport = codec.describeCapabilities(rawInfo, rawState);
    const observed = current.observe({
      capabilityReport,
      relayId,
      observedAt: this.#clock().toISOString(),
    });
    await this.#devices.saveDevice(observed, { expectedRevision: current.revision });
    return schoolCalcDeviceView(observed);
  }
}

export default ObserveSchoolCalcDevice;
