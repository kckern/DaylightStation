/**
 * YamlTeacherNotes — standalone teacher notes (spec D3):
 * `apps/school/teacher-notes.yml`, APPEND-ONLY `{id, at, from, learnerId,
 * note}`. Delivery reuses the review-note surfaces (student panel Feedback
 * list, the agenda's "Notes for you" window) — one delivery path, two
 * sources. Corrupt-file posture per the M3 rule.
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

export class YamlTeacherNotes {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlTeacherNotes requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'teacher-notes.yml'); }

  #readState() {
    let text;
    try { text = fsSync.readFileSync(this.#file(), 'utf8'); } catch { return { state: 'missing', entries: [] }; }
    try {
      const raw = yaml.load(text);
      if (Array.isArray(raw?.entries)) return { state: 'ok', entries: raw.entries };
    } catch { /* fall through */ }
    this.#logger.error?.('school.teacher-notes.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', entries: [] };
  }

  list({ learnerId = null } = {}) {
    const entries = this.#readState().entries;
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
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#readState();
      if (current.state === 'corrupt') {
        throw new Error(`teacher-notes.yml exists but cannot be read — fix or move it before writing (${this.#file()})`);
      }
      await atomicWrite(this.#file(), dumpYaml({ entries: [...current.entries, entry] }));
      this.#logger.info?.('school.teacher-note.recorded', { id: entry.id, learnerId: entry.learnerId });
    });
    await this.#writeChain;
    return entry;
  }
}

export default YamlTeacherNotes;
