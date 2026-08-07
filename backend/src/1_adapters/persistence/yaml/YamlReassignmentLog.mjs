/**
 * YamlReassignmentLog — the evidence-reassignment audit trail (Task 12,
 * debt M5): `apps/school/reassignments.yml`, APPEND-ONLY
 * `{at, fromLearnerId, toLearnerId, day, assessmentId, moved, reassignedBy}`.
 * Written best-effort by `ReassignEvidence` AFTER the move already
 * succeeded — the move itself is already provenance-stamped in the moved
 * events; this is the separate, queryable trail admin advocacy #9 asked
 * for. Unlike the attestation/teacher-notes logs, there is deliberately no
 * retraction machinery here: an audit trail records what happened and is
 * never itself edited or erased. Corrupt-file posture per the M3 rule:
 * reads warn and degrade to empty, writes refuse, all writes atomic.
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

export class YamlReassignmentLog {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlReassignmentLog requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'reassignments.yml'); }

  #readState() {
    let text;
    try { text = fsSync.readFileSync(this.#file(), 'utf8'); } catch { return { state: 'missing', entries: [] }; }
    try {
      const raw = yaml.load(text);
      if (Array.isArray(raw?.entries)) return { state: 'ok', entries: raw.entries };
    } catch { /* fall through */ }
    this.#logger.error?.('school.reassignments.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', entries: [] };
  }

  list({ learnerId = null } = {}) {
    const entries = this.#readState().entries;
    if (!learnerId) return entries;
    return entries.filter((e) => e.fromLearnerId === learnerId || e.toLearnerId === learnerId);
  }

  async append(entry) {
    // The stored chain swallows prior failures (final-review F2): one
    // rejected append must not wedge every later one for the process
    // lifetime. Each caller still awaits `run` and sees its own failure.
    const run = this.#writeChain.catch(() => {}).then(async () => {
      const current = this.#readState();
      if (current.state === 'corrupt') {
        throw new Error(`reassignments.yml exists but cannot be read — fix or move it before recording (${this.#file()})`);
      }
      await atomicWrite(this.#file(), dumpYaml({ entries: [...current.entries, entry] }));
      this.#logger.info?.('school.reassignment.recorded', {
        fromLearnerId: entry.fromLearnerId, toLearnerId: entry.toLearnerId, assessmentId: entry.assessmentId,
      });
    });
    this.#writeChain = run;
    await run;
    return entry;
  }
}

export default YamlReassignmentLog;
