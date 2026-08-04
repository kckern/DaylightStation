import path from 'node:path';
import { ISchoolCalcResultLedger } from '#apps/school/ports/ISchoolCalcResultLedger.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { classifySchoolCalcResultClaim } from '#domains/school/schoolcalc/index.mjs';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/** Durable single-writer result ledger; every mutation is atomically replaced on disk. */
export class YamlSchoolCalcResultLedger extends ISchoolCalcResultLedger {
  #directory; #io; #writeChain = Promise.resolve();

  constructor({ directory, io = {} } = {}) {
    super();
    if (typeof directory !== 'string' || !directory) throw new Error('YamlSchoolCalcResultLedger requires directory');
    this.#directory = directory;
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
  }

  async claimResult({ deviceId, sequence, recordDigest }) {
    return this.#mutate(deviceId, (document) => {
      const key = String(sequence);
      const existing = document.results[key] ?? null;
      const status = classifySchoolCalcResultClaim({
        existingDigest: existing?.recordDigest,
        incomingDigest: recordDigest,
        importComplete: existing?.state?.status === 'complete',
      });
      if (status === 'new') {
        document.results[key] = { sequence, recordDigest, state: { status: 'claimed' }, arrivals: [] };
      }
      return { status, entry: structuredClone(document.results[key] ?? existing) };
    });
  }

  async recordArrival({ deviceId, sequence, recordDigest, transport, receivedAt }) {
    if (!['qr', 'relay'].includes(transport)) throw new Error('SchoolCalc arrival transport must be qr|relay');
    if (!isCanonicalTimestamp(receivedAt)) {
      throw new Error('SchoolCalc arrival receivedAt must be a canonical ISO-8601 timestamp');
    }
    return this.#mutate(deviceId, (document) => {
      const entry = document.results[String(sequence)];
      if (!entry) throw missingClaim(deviceId, sequence);
      entry.arrivals.push({ recordDigest, transport, receivedAt });
      return structuredClone(entry);
    });
  }

  async saveImportState({ deviceId, sequence, state }) {
    return this.#mutate(deviceId, (document) => {
      const entry = document.results[String(sequence)];
      if (!entry) throw missingClaim(deviceId, sequence);
      if (!state || !['importing', 'complete'].includes(state.status)) {
        throw new Error('SchoolCalc import state must be importing|complete');
      }
      entry.state = structuredClone(state);
      return structuredClone(entry);
    });
  }

  async listAcknowledgedSequences(deviceId) {
    const document = this.#load(deviceId);
    return Object.values(document.results)
      .filter((entry) => entry.state?.status === 'complete')
      .map((entry) => entry.sequence)
      .sort((a, b) => a - b);
  }

  async #mutate(deviceId, mutation) {
    const operation = this.#writeChain.then(() => {
      const document = this.#load(deviceId);
      const result = mutation(document);
      this.#io.save(this.#path(deviceId), document, { noRefs: true });
      return result;
    });
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  #load(deviceId) {
    assertDeviceId(deviceId);
    const loaded = this.#io.load(this.#path(deviceId));
    if (!loaded) return { schema: 'school.calc.result-ledger/v1', deviceId, results: {} };
    if (loaded.schema !== 'school.calc.result-ledger/v1' || loaded.deviceId !== deviceId
      || !loaded.results || typeof loaded.results !== 'object' || Array.isArray(loaded.results)) {
      throw new DomainInvariantError(`SchoolCalc result ledger '${deviceId}' is invalid`, {
        code: 'INVALID_SCHOOLCALC_RESULT_LEDGER',
      });
    }
    return loaded;
  }

  #path(deviceId) { assertDeviceId(deviceId); return path.join(this.#directory, `${deviceId}.yml`); }
}

function assertDeviceId(deviceId) {
  if (!SAFE_ID.test(deviceId || '')) throw new Error('SchoolCalc ledger deviceId is unsafe');
}

function missingClaim(deviceId, sequence) {
  return new DomainInvariantError(`SchoolCalc result '${deviceId}:${sequence}' was not claimed`, {
    code: 'SCHOOLCALC_RESULT_NOT_CLAIMED',
  });
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

export default YamlSchoolCalcResultLedger;
