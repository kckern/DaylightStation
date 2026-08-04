import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { schoolCalcDeviceView } from './deviceView.mjs';
import { schoolCalcLearnerRosterView } from './GetSchoolCalcLearnerRoster.mjs';

const MAX_ID_ATTEMPTS = 8;

/** Enroll one calculator without assuming a calculator family or learner. */
export class EnrollSchoolCalcDevice {
  #devices; #codecs; #deviceIdFactory; #learners; #clock;

  constructor({ devices, codecs, deviceIdFactory, learners = null, clock = () => new Date() } = {}) {
    if (!devices || !codecs || typeof deviceIdFactory !== 'function'
        || !learners || typeof learners.listLearners !== 'function') {
      throw new Error('EnrollSchoolCalcDevice requires devices, codecs, deviceIdFactory, and learners');
    }
    this.#devices = devices;
    this.#codecs = codecs;
    this.#deviceIdFactory = deviceIdFactory;
    this.#learners = learners;
    this.#clock = clock;
  }

  async execute({ platformId, label, catalogId } = {}) {
    const codec = this.#codecs.get(platformId);

    let deviceId = null;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      // The factory owns compact-ID entropy/format; the application only
      // enforces repository uniqueness.
      // eslint-disable-next-line no-await-in-loop
      const candidate = await this.#deviceIdFactory({ platformId });
      // eslint-disable-next-line no-await-in-loop
      if (!await this.#devices.getDevice(candidate)) { deviceId = candidate; break; }
    }
    if (!deviceId) throw new Error('SchoolCalc could not allocate a unique device identity');

    const createdAt = readClock(this.#clock);
    const enrolled = SchoolCalcDevice.enroll({ deviceId, label, platformId, catalogId, createdAt });
    const { device } = enrolled.synchronizeLearners({
      learners: await this.#learners.listLearners(), synchronizedAt: createdAt,
    });
    await this.#devices.saveDevice(device, { expectedRevision: null });
    const learnerRoster = schoolCalcLearnerRosterView(device, codec);
    return {
      device: schoolCalcDeviceView(device),
      identityRecord: codec.encodeDeviceIdentity({ deviceId }),
      learnerRoster,
    };
  }
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('SchoolCalc enrollment clock must return a valid Date');
  }
  return value.toISOString();
}

export default EnrollSchoolCalcDevice;
