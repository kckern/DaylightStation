/**
 * YamlAttestationLog — teacher attestation overrides (spec D2):
 * `school/records/attestations.yml`, APPEND-ONLY `{id, at, attestedBy,
 * learnerId, unitId, reason}`. Its own evidence kind: it unlocks gates
 * (planner/milestones treat an attested unit as passed) but never
 * masquerades as an engine grade — the report card does not read it.
 * Corrupt-file posture per the M3 rule: reads warn, writes refuse, atomic.
 */
import fsSync from 'fs';
import path from 'path';
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

  #file() { return this.#configService.getHouseholdPath('school/records/attestations.yml'); }

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

  list({ learnerId = null, includeRetracted = false } = {}) {
    const entries = this.#readState().entries;
    if (includeRetracted) {
      // The withdrawn record, visible (admin advocacy #13): every non-retraction
      // row, annotated with who withdrew it and when — 'what was retracted'
      // used to be answerable only by reading YAML off the volume.
      const byTarget = new Map(entries.filter((e) => e.kind === 'retraction').map((e) => [e.retracts, e]));
      const all = entries.filter((e) => e.kind !== 'retraction').map((e) => {
        const r = byTarget.get(e.id);
        return r ? { ...e, retracted: true, retractedBy: r.by ?? null, retractedAt: r.at ?? null } : { ...e, retracted: false };
      });
      const scoped = learnerId ? all.filter((e) => e.learnerId === learnerId) : all;
      return scoped;
    }
    const retracted = new Set(entries.filter((e) => e.kind === 'retraction').map((e) => e.retracts));
    const liveEntries = entries.filter((e) => e.kind !== 'retraction' && !retracted.has(e.id));
    return learnerId ? liveEntries.filter((e) => e.learnerId === learnerId) : liveEntries;
  }

  /**
   * Append-only correction (advocacy B15): a retraction entry names the id
   * it retracts; `list()` folds them out. Nothing is ever edited or deleted
   * — the eraser is itself a record.
   */
  async retract(entryId, { by = null, at = new Date().toISOString() } = {}) {
    return this.append({ id: `ret_${entryId}`, kind: 'retraction', retracts: entryId, by, at });
  }


  async append(entry) {
    // The stored chain swallows prior failures (final-review F2): one
    // rejected append must not wedge every later one for the process
    // lifetime. Each caller still awaits `run` and sees its own failure.
    const run = this.#writeChain.catch(() => {}).then(async () => {
      const current = this.#readState();
      if (current.state === 'corrupt') {
        throw new Error(`attestations.yml exists but cannot be read — fix or move it before recording (${this.#file()})`);
      }
      await atomicWrite(this.#file(), dumpYaml({ entries: [...current.entries, entry] }));
      this.#logger.info?.('school.attestation.recorded', { id: entry.id, learnerId: entry.learnerId, unitId: entry.unitId });
    });
    this.#writeChain = run;
    await run;
    return entry;
  }
}

export default YamlAttestationLog;
