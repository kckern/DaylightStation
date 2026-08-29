export class SchoolCalcIdentityPolicy {
  constructor({ randomBytesFactory } = {}) {
    if (typeof randomBytesFactory !== 'function') throw new Error('SchoolCalcIdentityPolicy requires entropy');
    this.randomBytes = randomBytesFactory;
  }
  studySessionId() { return `study_${Buffer.from(this.#bytes(8, 'study ID')).toString('hex')}`; }
  studyCode() { return Buffer.from(this.#bytes(3, 'study code')).readUIntBE(0, 3) % 1_000_000; }
  deviceId() { return `SC${Buffer.from(this.#bytes(6, 'device ID')).toString('hex').toUpperCase()}`; }
  #bytes(length, purpose) {
    const entropy = this.randomBytes(length);
    if ((!Buffer.isBuffer(entropy) && !(entropy instanceof Uint8Array)) || entropy.byteLength !== length) {
      throw new Error(`SchoolCalc ${purpose} entropy source must return ${length} bytes`);
    }
    return entropy;
  }
}
