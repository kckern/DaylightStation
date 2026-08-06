/**
 * YamlEnrichmentLog — out-of-band learning entries (plan W3-4, spec B6):
 * `apps/school/enrichment.yml` `{entries: [...]}`, APPEND-ONLY — an
 * attributed evidence kind (recordedBy, learnerIds, date range, subjects),
 * a cousin of attestation: parent-recorded, never merged into graded
 * evidence, never inflating mastery.
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


export class YamlEnrichmentLog {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlEnrichmentLog requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'enrichment.yml'); }

  #readState() {
    let text;
    try { text = fsSync.readFileSync(this.#file(), 'utf8'); } catch { return { state: 'missing', entries: [] }; }
    try {
      const raw = yaml.load(text);
      if (Array.isArray(raw?.entries)) return { state: 'ok', entries: raw.entries };
    } catch { /* fall through */ }
    this.#logger.error?.('school.enrichment.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', entries: [] };
  }

  #read() { return this.#readState().entries; }

  list({ learnerId = null } = {}) {
    const entries = this.#read();
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
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#readState();
      // An append-only evidence log must never truncate itself over a file
      // it could not read (M3 review): corrupt refuses, it never overwrites.
      if (current.state === 'corrupt') {
        throw new Error(`enrichment.yml exists but cannot be read — fix or move it before recording (${this.#file()})`);
      }
      await atomicWrite(this.#file(), dumpYaml({ entries: [...current.entries, entry] }));
      this.#logger.info?.('school.enrichment.recorded', { id: entry.id, recordedBy: entry.recordedBy });
    });
    await this.#writeChain;
    return entry;
  }
}

export default YamlEnrichmentLog;
