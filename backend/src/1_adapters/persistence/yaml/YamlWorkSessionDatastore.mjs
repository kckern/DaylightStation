/**
 * YAML persistence for work-session event logs (spec §5.1). Dumb storage only —
 * lifecycle policy lives in `#domains/school/sessions/sessionEvents.mjs`.
 *
 *   record: <dataDir>/household/school/records/sessions/{YYYY-MM}/{sessionId}.yml
 *
 * A record contains its append-only `events:` array. The month bucket is from
 * creation time; no separate folder or hand-maintained index duplicates the
 * same session facts.
 */
import path from 'path';
import yaml from 'js-yaml';
import { IWorkSessionRepository } from '#apps/school/ports/IWorkSessionRepository.mjs';
import { reduceSession, transitionViolation } from '#domains/school/sessions/sessionEvents.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import {
  ensureDirAsync, fileExistsAsync, readDirectoryAsync, readTextFromPathAsync, writeTextFileAsync,
} from '#system/utils/FileIO.mjs';

// Single flat segment, starting alphanumeric: "..", a leading "/", a hidden name
// and a nested path all fail to match, which is what keeps traversal out (same
// guard shape as YamlSchoolDatastore's bank ids).
const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const MONTH_RE = /^\d{4}-\d{2}$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeSessionId = (id) => typeof id === 'string' && SESSION_ID_RE.test(id);
// Total over junk entries: a malformed line sorts to the front rather than throwing.
const seqOf = (event) => (event && typeof event === 'object' ? Number(event.seq) : NaN) || 0;

export class YamlWorkSessionDatastore extends IWorkSessionRepository {
  #configService;
  #logger;
  // One queue for every append on this instance. Per-session queues would be
  // faster, but an append is a read-modify-write over a small file and a lost
  // event is a lost piece of a child's work record — throughput is not the
  // thing worth optimising here. (House precedent: barcodeRelay.mjs.)
  #writeChain = Promise.resolve();
  #monthCache = new Map();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlWorkSessionDatastore: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #root() { return this.#configService.getHouseholdPath('school/records/sessions'); }

  async #readYaml(file) {
    let text;
    try {
      text = await readTextFromPathAsync(file);
    } catch (err) {
      // Missing is the ordinary case (a month with no sessions, a probe for the
      // bucket a session lives in) and stays quiet. An unreadable-but-present
      // file is not ordinary, so it is reported before being answered the same.
      if (err?.code !== 'ENOENT') {
        this.#logger.error?.('school.session.file-unreadable', { file, error: err?.message });
      }
      return null;
    }
    try {
      return yaml.load(text);
    } catch (err) {
      // Corrupt, deliberately answered the same as missing: one corrupt session
      // must not take down the agenda for every other child. But a child's work
      // record silently reading as absent is exactly what a later review needs
      // to know about, so it is recorded on the way past.
      this.#logger.error?.('school.session.file-corrupt', { file, error: err?.message });
      return null;
    }
  }

  /** Creation-month directories, newest first. */
  async #months() {
    let entries;
    try {
      entries = await readDirectoryAsync(this.#root(), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && MONTH_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  }

  /**
   * Which month folder holds this session.
   *
   * Resolution order: cache, then a newest-first scan of the month folders, then —
   * only for an event that is opening a new session — the event's own timestamp.
   */
  async #resolveMonth(sessionId, event = null) {
    const cached = this.#monthCache.get(sessionId);
    if (cached) return cached;
    for (const month of await this.#months()) {
      try {
        if (!(await fileExistsAsync(path.join(this.#root(), month, `${sessionId}.yml`)))) continue;
        this.#monthCache.set(sessionId, month);
        return month;
      } catch { /* not this month */ }
    }
    if (!event) return null;
    const at = typeof event.at === 'string' ? event.at : '';
    const month = at.slice(0, 7);
    if (!MONTH_RE.test(month) || Number.isNaN(Date.parse(at))) {
      throw new Error('YamlWorkSessionDatastore: event.at must be an ISO-8601 timestamp');
    }
    this.#monthCache.set(sessionId, month);
    return month;
  }

  async #readEventsAt(month, sessionId) {
    const raw = await this.#readYaml(path.join(this.#root(), month, `${sessionId}.yml`));
    if (!Array.isArray(raw?.events)) return [];
    // Entries are sorted but never filtered: a malformed entry is the reducer's
    // to report, and dropping it here would hide it from the one place a parent
    // could see that something went wrong.
    return [...raw.events].sort((a, b) => seqOf(a) - seqOf(b));
  }

  /** @inheritdoc */
  async appendEvent(sessionId, event, { expectedSeq } = {}) {
    if (!isSafeSessionId(sessionId)) {
      throw new Error(`YamlWorkSessionDatastore: unsafe sessionId: ${sessionId}`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('YamlWorkSessionDatastore: event must be a mapping');
    }
    const run = async () => {
      const month = await this.#resolveMonth(sessionId, event);
      const dir = path.join(this.#root(), month);
      await ensureDirAsync(dir);
      const events = await this.#readEventsAt(month, sessionId);
      // seq is assigned HERE, inside the queue, and overrides whatever the
      // caller passed: two callers that each read nextSeq() before either wrote
      // would otherwise be handed the same number.
      const maxSeq = events.reduce((m, e) => Math.max(m, seqOf(e)), 0);
      if (expectedSeq !== undefined && expectedSeq !== maxSeq) {
        throw new DomainInvariantError(`session ${sessionId} changed after this preview`, {
          code: 'STALE_SAVE', details: { expected: expectedSeq, actual: maxSeq },
        });
      }
      // LEGALITY IS DECIDED HERE, not by each of the two dozen callers that
      // reach this method. `TRANSITIONS` used to be authoritative only inside
      // `reduceSession`, at read time, where an illegal event is recorded in
      // `errors[]` and skipped. Read-total is right for READS — a damaged log
      // must still yield up whatever record of a child's work survives — but
      // applied to writes it means the log accepts facts that never happened,
      // and callers each carried their own hand-copied projection of what was
      // legal. That is how a session came to hold an `issued` event for an
      // artifact that was never produced, and became permanently unprintable.
      //
      // The check runs INSIDE the write queue, against the state as it stands
      // at this instant, because two appends racing on the same session would
      // otherwise each validate against a state the other is about to move on.
      const from = reduceSession(events).state;
      const violation = transitionViolation(from, event.type);
      if (violation) {
        this.#logger.warn?.('school.session.illegal-transition', {
          sessionId, from, type: event.type, reason: violation,
        });
        throw new DomainInvariantError(`session ${sessionId}: ${violation}`, {
          code: 'ILLEGAL_TRANSITION', details: { from, type: event.type, seq: maxSeq + 1 },
        });
      }
      const stored = { ...event, sessionId, seq: maxSeq + 1 };
      events.push(stored);
      await writeTextFileAsync(path.join(dir, `${sessionId}.yml`), dumpYaml({
        schema: 'school.work-session/v1', sessionId,
        startedAt: events[0]?.at ?? null, events,
      }));
      return stored;
    };
    const queued = this.#writeChain.then(run);
    // The chain must survive a rejected append, or one bad write would strand
    // every later one. The caller still sees the rejection through `queued`.
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async readEvents(sessionId) {
    if (!isSafeSessionId(sessionId)) return [];
    const month = await this.#resolveMonth(sessionId);
    if (!month) return [];
    return this.#readEventsAt(month, sessionId);
  }

  /** @inheritdoc */
  async nextSeq(sessionId) {
    const events = await this.readEvents(sessionId);
    return events.reduce((m, e) => Math.max(m, seqOf(e)), 0) + 1;
  }

  /** Every session fact for a learner, newest creation month first. */
  async #rowsFor(learnerId) {
    if (typeof learnerId !== 'string' || learnerId.trim() === '') return [];
    const out = [];
    for (const month of await this.#months()) {
      let entries;
      try { entries = await readDirectoryAsync(path.join(this.#root(), month), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith('.yml'))) {
        const sessionId = entry.name.slice(0, -4);
        if (!isSafeSessionId(sessionId)) continue;
        // eslint-disable-next-line no-await-in-loop
        const events = await this.#readEventsAt(month, sessionId);
        const state = reduceSession(events);
        if (state.learnerId !== learnerId) continue;
        const last = events[events.length - 1];
        out.push({ sessionId, day: events[0]?.at?.slice(0, 10) ?? null, row: {
          // `day` above is the UTC date the log was OPENED; `studyDay` is the
          // household's own 4am-boundary day, minted timezone-aware when the
          // session was created. West of UTC the two disagree for everything
          // after late afternoon local, so a consumer bucketing by day needs
          // the real one — `studyDay ?? day` — not the timestamp slice.
          studyDay: state.studyDay ?? null,
          learnerId: state.learnerId, unitId: state.unitId, state: state.state,
          open: !state.terminal, result: state.outcome?.result ?? null,
          gradedPercent: state.gradedPercent ?? null, updatedAt: last?.at ?? null,
        } });
      }
    }
    return out; // months already newest-first
  }

  /** @inheritdoc */
  async listOpenForLearner(learnerId) {
    return (await this.#rowsFor(learnerId))
      .filter(({ row }) => row.open)
      .map(({ sessionId, day, row }) => ({
        sessionId,
        learnerId: row.learnerId,
        unitId: row.unitId ?? null,
        state: row.state ?? null,
        day,
        updatedAt: row.updatedAt ?? null,
      }));
  }

  /** @inheritdoc */
  async listForLearner(learnerId) {
    const rows = await this.#rowsFor(learnerId);
    const facts = [];
    for (const { sessionId, day, row } of rows) {
      facts.push({
        sessionId,
        learnerId: row.learnerId,
        unitId: row.unitId ?? null,
        state: row.state ?? null,
        terminal: row.open === false,
        outcome: row.result ? { result: row.result } : null,
        gradedPercent: row.gradedPercent ?? null,
        day,
        studyDay: row.studyDay ?? null,
        updatedAt: row.updatedAt ?? null,
      });
    }
    return facts;
  }
}

export default YamlWorkSessionDatastore;
