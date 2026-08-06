/**
 * YamlAttestationLog — teacher attestation overrides (spec D2):
 * `apps/school/attestations.yml`, APPEND-ONLY `{id, at, attestedBy,
 * learnerId, unitId, reason}`. Its own evidence kind: it unlocks gates
 * (planner/milestones treat an attested unit as passed) but never
 * masquerades as an engine grade — the report card does not read it.
 * Corrupt-file posture per the M3 rule: reads warn, writes refuse, atomic.
 */
import path from 'path';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

export class YamlAttestationLog {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlAttestationLog requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'attestations.yml'); }

  #readState() {
    let text;
    try { text = fsSync.readFileSync(this.#file(), 'utf8'); } catch { return { state: 'missing', entries: [] }; }
    try {
      const raw = yaml.load(text);
      if (Array.isArray(raw?.entries)) return { state: 'ok', entries: raw.entries };
    } catch { /* fall through */ }
    this.#logger.error?.('school.attestations.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', entries: [] };
  }

  list({ learnerId = null } = {}) {
    const entries = this.#readState().entries;
    return learnerId ? entries.filter((e) => e.learnerId === learnerId) : entries;
  }

  async append(entry) {
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#readState();
      if (current.state === 'corrupt') {
        throw new Error(`attestations.yml exists but cannot be read — fix or move it before recording (${this.#file()})`);
      }
      await atomicWrite(this.#file(), dumpYaml({ entries: [...current.entries, entry] }));
      this.#logger.info?.('school.attestation.recorded', { id: entry.id, learnerId: entry.learnerId, unitId: entry.unitId });
    });
    await this.#writeChain;
    return entry;
  }
}

export default YamlAttestationLog;
