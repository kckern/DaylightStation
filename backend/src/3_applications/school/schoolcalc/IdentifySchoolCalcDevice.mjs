import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

/** Resolve an opaque provisioned calculator identity without teaching the relay its byte format. */
export class IdentifySchoolCalcDevice {
  #devices; #codecs;

  constructor({ devices, codecs } = {}) {
    if (!devices || !codecs) throw new Error('IdentifySchoolCalcDevice requires devices and codecs');
    this.#devices = devices;
    this.#codecs = codecs;
  }

  async execute({ record } = {}) {
    const { codec, identity } = this.#codecs.decodeDeviceIdentity(record);
    const device = await this.#devices.getDevice(identity.deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', identity.deviceId);
    if (device.platformId !== codec.platformId || identity.platformId !== device.platformId) {
      throw new ValidationError('SchoolCalc identity codec does not match enrolled device platform', {
        code: 'SCHOOLCALC_DEVICE_IDENTITY_PLATFORM_MISMATCH',
      });
    }
    return {
      deviceId: device.deviceId,
      platformId: device.platformId,
      label: device.label,
      revision: device.revision,
    };
  }
}

export default IdentifySchoolCalcDevice;
