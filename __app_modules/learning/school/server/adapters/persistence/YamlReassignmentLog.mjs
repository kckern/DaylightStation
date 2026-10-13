/**
 * YamlReassignmentLog — the evidence-reassignment audit trail (Task 12,
 * debt M5): `school/records/reassignments.yml`, APPEND-ONLY
 * `{at, fromLearnerId, toLearnerId, day, assessmentId, moved, reassignedBy}`.
 * Written best-effort by `ReassignEvidence` AFTER the move already
 * succeeded — the move itself is already provenance-stamped in the moved
 * events; this is the separate, queryable trail admin advocacy #9 asked
 * for. Unlike the attestation/teacher-notes logs, there is deliberately no
 * retraction machinery here: an audit trail records what happened and is
 * never itself edited or erased. Corrupt-file posture per the M3 rule:
 * reads warn and degrade to empty, writes refuse, all writes atomic.
 */
import yaml from 'js-yaml';
import { readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

async function atomicWrite(file, text) { writeFileAtomic(file, text); }

export class YamlReassignmentLog {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlReassignmentLog requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return this.#configService.getHouseholdPath('school/records/reassignments.yml'); }

  #readState() {
    let text;
    try { text = readTextFromPath(this.#file()); } catch { return { state: 'missing', entries: [] }; }
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
