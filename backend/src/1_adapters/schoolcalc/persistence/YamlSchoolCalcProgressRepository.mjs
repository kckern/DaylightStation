import path from 'node:path';
import { ISchoolCalcProgressRepository } from '#apps/school/ports/ISchoolCalcProgressRepository.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/** Highest-sequence progress snapshot per device/artifact. */
export class YamlSchoolCalcProgressRepository extends ISchoolCalcProgressRepository {
  #directory; #io; #writeChain = Promise.resolve();

  constructor({ directory, io = {} } = {}) {
    super();
    if (typeof directory !== 'string' || !directory) throw new Error('YamlSchoolCalcProgressRepository requires directory');
    this.#directory = directory;
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
  }

  async saveLatest(progress) {
    const operation = this.#writeChain.then(() => {
      const document = this.#load(progress.deviceId);
      const current = document.artifacts[progress.artifactId] ?? null;
      if (current && progress.sequence < current.sequence) return { status: 'stale', progress: structuredClone(current) };
      if (current && progress.sequence === current.sequence) {
        if (current.recordDigest !== progress.recordDigest) {
          throw new DomainInvariantError('SchoolCalc progress sequence was reused with different content', {
            code: 'SCHOOLCALC_PROGRESS_CONFLICT',
          });
        }
        return { status: 'duplicate', progress: structuredClone(current) };
      }
      document.artifacts[progress.artifactId] = structuredClone(progress);
      this.#io.save(this.#path(progress.deviceId), document, { noRefs: true });
      return { status: 'accepted', progress: structuredClone(progress) };
    });
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  async getLatest({ deviceId, artifactId }) {
    const current = this.#load(deviceId).artifacts[artifactId];
    return current ? structuredClone(current) : null;
  }

  #load(deviceId) {
    assertDeviceId(deviceId);
    const loaded = this.#io.load(this.#path(deviceId));
    if (!loaded) return { schema: 'school.calc.progress-ledger/v1', deviceId, artifacts: {} };
    if (loaded.schema !== 'school.calc.progress-ledger/v1' || loaded.deviceId !== deviceId
      || !loaded.artifacts || typeof loaded.artifacts !== 'object' || Array.isArray(loaded.artifacts)) {
      throw new DomainInvariantError(`SchoolCalc progress ledger '${deviceId}' is invalid`, {
        code: 'INVALID_SCHOOLCALC_PROGRESS_LEDGER',
      });
    }
    return loaded;
  }

  #path(deviceId) { assertDeviceId(deviceId); return path.join(this.#directory, `${deviceId}.yml`); }
}

function assertDeviceId(deviceId) {
  if (!SAFE_ID.test(deviceId || '')) throw new Error('SchoolCalc progress deviceId is unsafe');
}

export default YamlSchoolCalcProgressRepository;

