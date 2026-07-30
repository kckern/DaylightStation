/**
 * YAML persistence for work-session event logs (spec §5.1). Dumb storage only —
 * lifecycle policy lives in `#domains/school/sessions/sessionEvents.mjs`.
 *
 *   events: <dataDir>/apps/school/sessions/{YYYY-MM-DD}/{sessionId}/events.yml   (append-only)
 *   index:  <dataDir>/apps/school/sessions/{YYYY-MM-DD}/index.yml                (open sessions by learner)
 *
 * The day bucket is the day the session was CREATED, not the day of each event:
 * a session is one folder for its whole life, so a piece of work started before
 * bedtime and finished the next morning stays one record.
 *
 * The index is a derived convenience — it is rebuilt from the log on every
 * append, never edited independently — so "what is this child in the middle of"
 * costs one file read per day instead of a walk over every session's events.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { IWorkSessionRepository } from '#apps/school/ports/IWorkSessionRepository.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

// Single flat segment, starting alphanumeric: "..", a leading "/", a hidden name
// and a nested path all fail to match, which is what keeps traversal out (same
// guard shape as YamlSchoolDatastore's bank ids).
const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVENTS_FILE = 'events.yml';
const INDEX_FILE = 'index.yml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeSessionId = (id) => typeof id === 'string' && SESSION_ID_RE.test(id);
// Total over junk entries: a malformed line sorts to the front rather than throwing.
const seqOf = (event) => (event && typeof event === 'object' ? Number(event.seq) : NaN) || 0;

export class YamlWorkSessionDatastore extends IWorkSessionRepository {
  #configService;
  // One queue for every append on this instance. Per-session queues would be
  // faster, but an append is a read-modify-write over a small file and a lost
  // event is a lost piece of a child's work record — throughput is not the
  // thing worth optimising here. (House precedent: barcodeRelay.mjs.)
  #writeChain = Promise.resolve();
  #dayCache = new Map();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getDataDir !== 'function') {
      throw new Error('YamlWorkSessionDatastore: configService with getDataDir() is required');
    }
    this.#configService = config.configService;
  }

  #root() { return path.join(this.#configService.getDataDir(), 'apps', 'school', 'sessions'); }

  async #readYaml(file) {
    try {
      return yaml.load(await fs.readFile(file, 'utf8'));
    } catch {
      // Missing OR unparseable, deliberately the same answer: one corrupt
      // session must not take down the agenda for every other child.
      return null;
    }
  }

  /** Day directories, newest first. */
  async #days() {
    let entries;
    try {
      entries = await fs.readdir(this.#root(), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && DAY_RE.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
  }

  /**
   * Which day folder holds this session.
   *
   * Resolution order: cache, then a newest-first scan of the day folders, then —
   * only for an event that is opening a new session — the event's own timestamp.
   */
  async #resolveDay(sessionId, event = null) {
    const cached = this.#dayCache.get(sessionId);
    if (cached) return cached;
    for (const day of await this.#days()) {
      try {
        await fs.access(path.join(this.#root(), day, sessionId, EVENTS_FILE));
        this.#dayCache.set(sessionId, day);
        return day;
      } catch { /* not this day */ }
    }
    if (!event) return null;
    const at = typeof event.at === 'string' ? event.at : '';
    const day = at.slice(0, 10);
    if (!DAY_RE.test(day) || Number.isNaN(Date.parse(at))) {
      throw new Error('YamlWorkSessionDatastore: event.at must be an ISO-8601 timestamp');
    }
    this.#dayCache.set(sessionId, day);
    return day;
  }

  async #readEventsAt(day, sessionId) {
    const raw = await this.#readYaml(path.join(this.#root(), day, sessionId, EVENTS_FILE));
    if (!Array.isArray(raw)) return [];
    // Entries are sorted but never filtered: a malformed entry is the reducer's
    // to report, and dropping it here would hide it from the one place a parent
    // could see that something went wrong.
    return [...raw].sort((a, b) => seqOf(a) - seqOf(b));
  }

  /** Rebuild this session's row in the day index from its whole log. */
  async #reindex(day, sessionId, events) {
    const file = path.join(this.#root(), day, INDEX_FILE);
    const raw = await this.#readYaml(file);
    const index = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const state = reduceSession(events);
    const last = events[events.length - 1];
    index[sessionId] = {
      learnerId: state.learnerId,
      unitId: state.unitId,
      state: state.state,
      open: !state.terminal,
      // The gating question ("has this unit been passed?") must be answerable
      // from the index alone, or the planner would reduce every session a
      // learner has ever had just to draw one agenda.
      result: state.outcome?.result ?? null,
      gradedPercent: state.gradedPercent ?? null,
      updatedAt: (last && typeof last === 'object' ? last.at : null) ?? null,
    };
    await fs.writeFile(file, dumpYaml(index), 'utf8');
  }

  /** @inheritdoc */
  async appendEvent(sessionId, event) {
    if (!isSafeSessionId(sessionId)) {
      throw new Error(`YamlWorkSessionDatastore: unsafe sessionId: ${sessionId}`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('YamlWorkSessionDatastore: event must be a mapping');
    }
    const run = async () => {
      const day = await this.#resolveDay(sessionId, event);
      const dir = path.join(this.#root(), day, sessionId);
      await fs.mkdir(dir, { recursive: true });
      const events = await this.#readEventsAt(day, sessionId);
      // seq is assigned HERE, inside the queue, and overrides whatever the
      // caller passed: two callers that each read nextSeq() before either wrote
      // would otherwise be handed the same number.
      const maxSeq = events.reduce((m, e) => Math.max(m, seqOf(e)), 0);
      const stored = { ...event, sessionId, seq: maxSeq + 1 };
      events.push(stored);
      await fs.writeFile(path.join(dir, EVENTS_FILE), dumpYaml(events), 'utf8');
      await this.#reindex(day, sessionId, events);
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
    const day = await this.#resolveDay(sessionId);
    if (!day) return [];
    return this.#readEventsAt(day, sessionId);
  }

  /** @inheritdoc */
  async nextSeq(sessionId) {
    const events = await this.readEvents(sessionId);
    return events.reduce((m, e) => Math.max(m, seqOf(e)), 0) + 1;
  }

  /** Every indexed row for a learner, newest day first. */
  async #rowsFor(learnerId) {
    if (typeof learnerId !== 'string' || learnerId.trim() === '') return [];
    const out = [];
    for (const day of await this.#days()) {
      // eslint-disable-next-line no-await-in-loop
      const raw = await this.#readYaml(path.join(this.#root(), day, INDEX_FILE));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      Object.entries(raw)
        .filter(([, row]) => row && typeof row === 'object' && row.learnerId === learnerId)
        .forEach(([sessionId, row]) => out.push({ sessionId, day, row }));
    }
    return out; // days already newest-first
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
    return (await this.#rowsFor(learnerId)).map(({ sessionId, day, row }) => ({
      sessionId,
      learnerId: row.learnerId,
      unitId: row.unitId ?? null,
      state: row.state ?? null,
      // A session written before the index carried a result reduces to
      // `open: true, result: null`, which reads as "unfinished" — the safe
      // direction: worst case a completed unit is offered again.
      terminal: row.open === false,
      outcome: row.result ? { result: row.result } : null,
      gradedPercent: row.gradedPercent ?? null,
      day,
      updatedAt: row.updatedAt ?? null,
    }));
  }
}

export default YamlWorkSessionDatastore;
