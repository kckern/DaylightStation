/**
 * YamlEnrichmentLog — out-of-band learning entries (plan W3-4, spec B6):
 * `school/records/enrichment.yml` `{entries: [...]}`, APPEND-ONLY — an
 * attributed evidence kind (recordedBy, learnerIds, date range, subjects),
 * a cousin of attestation: parent-recorded, never merged into graded
 * evidence, never inflating mastery.
 */
import yaml from 'js-yaml';
import { readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

async function atomicWrite(file, text) { writeFileAtomic(file, text); }


export class YamlEnrichmentLog {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlEnrichmentLog requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return this.#configService.getHouseholdPath('school/records/enrichment.yml'); }

  #readState() {
    let text;
    try { text = readTextFromPath(this.#file()); } catch { return { state: 'missing', entries: [] }; }
    try {
      const raw = yaml.load(text);
      if (Array.isArray(raw?.entries)) return { state: 'ok', entries: raw.entries };
    } catch { /* fall through */ }
    this.#logger.error?.('school.enrichment.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', entries: [] };
  }

  #read() { return this.#readState().entries; }

  list({ learnerId = null, includeRetracted = false } = {}) {
    const entries = this.#read();
    if (includeRetracted) {
      // The withdrawn record, visible (admin advocacy #13): every non-retraction
      // row, annotated with who withdrew it and when — 'what was retracted'
      // used to be answerable only by reading YAML off the volume.
      const byTarget = new Map(entries.filter((e) => e.kind === 'retraction').map((e) => [e.retracts, e]));
      const all = entries.filter((e) => e.kind !== 'retraction').map((e) => {
        const r = byTarget.get(e.id);
        return r ? { ...e, retracted: true, retractedBy: r.by ?? null, retractedAt: r.at ?? null } : { ...e, retracted: false };
      });
      const scoped = learnerId ? all.filter((e) => (e.learnerIds ?? []).includes(learnerId)) : all;
      return scoped;
    }
    const retracted = new Set(entries.filter((e) => e.kind === 'retraction').map((e) => e.retracts));
    const liveEntries = entries.filter((e) => e.kind !== 'retraction' && !retracted.has(e.id));
    return learnerId ? liveEntries.filter((e) => (e.learnerIds ?? []).includes(learnerId)) : liveEntries;
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
      // An append-only evidence log must never truncate itself over a file
      // it could not read (M3 review): corrupt refuses, it never overwrites.
      if (current.state === 'corrupt') {
        throw new Error(`enrichment.yml exists but cannot be read — fix or move it before recording (${this.#file()})`);
      }
      await atomicWrite(this.#file(), dumpYaml({ entries: [...current.entries, entry] }));
      this.#logger.info?.('school.enrichment.recorded', { id: entry.id, recordedBy: entry.recordedBy });
    });
    this.#writeChain = run;
    await run;
    return entry;
  }
}

export default YamlEnrichmentLog;
