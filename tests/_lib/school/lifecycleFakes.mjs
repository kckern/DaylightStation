/**
 * In-memory doubles for every port the School lifecycle use cases depend on.
 *
 * An application test never touches the filesystem, a printer, or a clock:
 * everything a use case can see arrives through one of these. Each double
 * implements the real port (so `instanceof` checks in the use cases would hold)
 * and records what it was asked to do, so a test asserts on EFFECTS rather than
 * on internal calls.
 *
 * The clock and the rng are injectable for the same reason: a lifecycle whose
 * behaviour depends on the wall clock cannot be tested at a day boundary, and
 * the spec's reward path has a cross-day scenario that must be exercised.
 */
import { ICurriculumCatalog } from '#apps/school/ports/ICurriculumCatalog.mjs';
import { IWorkSessionRepository } from '#apps/school/ports/IWorkSessionRepository.mjs';
import { ITokenRegistry } from '#apps/school/ports/ITokenRegistry.mjs';
import { IAssignmentStore } from '#apps/school/ports/IAssignmentStore.mjs';
import { IFormMapStore } from '#apps/school/ports/IFormMapStore.mjs';
import { IReviewQueue } from '#apps/school/ports/IReviewQueue.mjs';
import { IDocumentRenderer, IReceiptRenderer } from '#apps/school/ports/IDocumentRenderer.mjs';
import { GrownUpGate } from '#apps/school/GrownUpGate.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { TOKEN_PREFIX } from '#domains/school/sessions/tokens.mjs';

export const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * The household a lifecycle test runs in. One grown-up, one child, and one
 * profile whose birthyear was never filled in — the last is not padding: an
 * unknown birthyear is a child as far as authority goes, and that is the case
 * most likely to rot.
 */
export const FAKE_ROSTER = Object.freeze([
  Object.freeze({ id: 'parent', name: 'Parent', birthyear: 1985 }),
  Object.freeze({ id: 'kid1', name: 'Kid', birthyear: 2016 }),
  Object.freeze({ id: 'aunty', name: 'Aunty', birthyear: null }),
]);

/**
 * The gate the parent-only writes ask before they write anything.
 * @param {object} [clock] - a `fakeClock`; defaults to the fixture household's "now"
 * @param {Array<object>} [roster]
 */
export function fakeGrownUps(clock = fakeClock(), roster = FAKE_ROSTER) {
  return new GrownUpGate({ roster: () => roster, clock: clock.now, logger: silentLogger });
}

/** A clock a test moves by hand. */
export function fakeClock(startIso = '2026-07-27T09:00:00.000Z') {
  let at = Date.parse(startIso);
  return {
    now: () => new Date(at),
    iso: () => new Date(at).toISOString(),
    epoch: () => at,
    advanceMs(ms) { at += ms; return this; },
    advanceHours(h) { return this.advanceMs(h * 3_600_000); },
    advanceDays(d) { return this.advanceMs(d * 86_400_000); },
    set(iso) { at = Date.parse(iso); return this; },
  };
}

/** Deterministic draws in [0,1) — the same seed always mints the same token. */
export function seededRng(seed = 1) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** Sequential session ids, so a test can name `ses_1` before it exists. */
export function sequentialIds(prefix = 'ses_') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export class FakeCatalog extends ICurriculumCatalog {
  constructor({ units = [], documents = [], manifests = [] } = {}) {
    super();
    const entries = (list, key) => list.map((raw) => ({ id: raw?.[key] ?? 'anon', raw }));
    this.unitEntries = entries(units, 'unitId');
    this.documentEntries = entries(documents, 'id');
    this.manifestEntries = entries(manifests, 'id');
    this.reads = 0;
  }

  async listUnits() { this.reads += 1; return { items: this.unitEntries, errors: [] }; }
  async listDocuments() { return { items: this.documentEntries, errors: [] }; }
  async listManifests() { return { items: this.manifestEntries, errors: [] }; }
  // A catalog with no work configs is a valid catalog — most fixtures have none.
  async listWorks() { return { items: this.workEntries ?? [], errors: [] }; }
  async getWork(id) { return (this.workEntries ?? []).find((e) => e.id === id)?.raw ?? null; }
  async getUnit(id) { return this.unitEntries.find((e) => e.id === id)?.raw ?? null; }
  async getDocument(id) { return this.documentEntries.find((e) => e.id === id)?.raw ?? null; }
  async getManifest(id) { return this.manifestEntries.find((e) => e.id === id)?.raw ?? null; }
}

export class FakeSessionRepository extends IWorkSessionRepository {
  #logs = new Map(); // sessionId -> events[]

  async appendEvent(sessionId, event) {
    const events = this.#logs.get(sessionId) ?? [];
    // seq is stamped HERE, exactly like the YAML datastore — a caller-supplied
    // seq is advisory and overridden.
    const stored = { ...event, sessionId, seq: events.length + 1 };
    events.push(stored);
    this.#logs.set(sessionId, events);
    return stored;
  }

  async readEvents(sessionId) { return [...(this.#logs.get(sessionId) ?? [])]; }

  async nextSeq(sessionId) { return (this.#logs.get(sessionId)?.length ?? 0) + 1; }

  #rows(learnerId) {
    return [...this.#logs.entries()]
      .map(([sessionId, events]) => ({ sessionId, state: reduceSession(events), events }))
      .filter(({ state }) => state.learnerId === learnerId);
  }

  async listOpenForLearner(learnerId) {
    return this.#rows(learnerId)
      .filter(({ state }) => !state.terminal)
      .map(({ sessionId, state, events }) => ({
        sessionId,
        learnerId: state.learnerId,
        unitId: state.unitId,
        state: state.state,
        day: String(events[0]?.at ?? '').slice(0, 10),
        updatedAt: events[events.length - 1]?.at ?? null,
      }));
  }

  async listForLearner(learnerId) {
    return this.#rows(learnerId).map(({ sessionId, state, events }) => ({
      sessionId,
      learnerId: state.learnerId,
      unitId: state.unitId,
      state: state.state,
      terminal: state.terminal,
      outcome: state.outcome ? { result: state.outcome.result } : null,
      gradedPercent: state.gradedPercent ?? null,
      day: String(events[0]?.at ?? '').slice(0, 10),
      updatedAt: events[events.length - 1]?.at ?? null,
    }));
  }

  /** Test-only: the derived state, without a use case in the way. */
  derive(sessionId) { return reduceSession(this.#logs.get(sessionId) ?? []); }

  /** Test-only: every event type appended to a session, in order. */
  types(sessionId) { return (this.#logs.get(sessionId) ?? []).map((e) => e.type); }

  /** Test-only: the raw stored events, in order. */
  events(sessionId) { return [...(this.#logs.get(sessionId) ?? [])]; }

  /** Test-only: every session id that exists. */
  ids() { return [...this.#logs.keys()]; }
}

export class FakeTokenRegistry extends ITokenRegistry {
  #records = new Map();

  #key(token) {
    const t = String(token ?? '').trim();
    return t.startsWith(TOKEN_PREFIX) ? t.slice(TOKEN_PREFIX.length) : t;
  }

  async put(record) { this.#records.set(this.#key(record.token), record); return record; }

  async get(token) { return this.#records.get(this.#key(token)) ?? null; }

  async revoke(token, { at } = {}) {
    const record = await this.get(token);
    if (!record) return null;
    if (record.revokedAt) return record;
    const revoked = { ...record, revokedAt: at };
    this.#records.set(this.#key(token), revoked);
    return revoked;
  }

  /** Test-only. */
  all() { return [...this.#records.values()]; }

  ofClass(tokenClass) { return this.all().filter((r) => r.tokenClass === tokenClass); }
}

export class FakeAssignmentStore extends IAssignmentStore {
  #records = new Map();
  // learnerId -> AssignmentRecord[] (oldest first), mirroring the real store's
  // separate history log (YamlAssignmentStore#historyFileFor).
  #history = new Map();

  constructor(seed = []) {
    super();
    seed.forEach((r) => this.#records.set(r.learnerId, r));
  }

  async get(learnerId) { return this.#records.get(learnerId) ?? null; }

  async put(record) {
    this.#records.set(record.learnerId, record);
    const entry = { ...record, recordedAt: record.updatedAt ?? new Date().toISOString() };
    const list = this.#history.get(record.learnerId) ?? [];
    list.push(entry);
    this.#history.set(record.learnerId, list);
    return record;
  }

  async list() { return [...this.#records.values()]; }

  async history(learnerId) { return [...(this.#history.get(learnerId) ?? [])]; }

  /** Test-only: seed history directly, without going through `put`. */
  seedHistory(learnerId, entries) { this.#history.set(learnerId, [...entries]); }
}

export class FakeFormMapStore extends IFormMapStore {
  #maps = new Map();

  async put(formId, formMap) {
    if (this.#maps.has(formId)) return this.#maps.get(formId);
    this.#maps.set(formId, formMap);
    return formMap;
  }

  async get(formId) { return this.#maps.get(formId) ?? null; }

  ids() { return [...this.#maps.keys()]; }
}

export class FakeReviewQueue extends IReviewQueue {
  #items = new Map(); // sessionId -> items[]

  async enqueue(items) {
    if (!items.length) return [];
    const sessionId = items[0].sessionId;
    const existing = this.#items.get(sessionId) ?? [];
    items.forEach((item) => {
      const at = existing.findIndex((e) => e.itemId === item.itemId);
      if (at === -1) existing.push({ verdict: null, gradedBy: null, gradedAt: null, note: null, ...item });
      else if (!existing[at].verdict) existing[at] = { ...existing[at], ...item };
    });
    this.#items.set(sessionId, existing);
    return existing;
  }

  async listForSession(sessionId) { return [...(this.#items.get(sessionId) ?? [])]; }

  async resolve({ sessionId, itemId, verdict, gradedBy = null, note = null, at }) {
    const items = this.#items.get(sessionId) ?? [];
    const index = items.findIndex((i) => i.itemId === itemId);
    if (index === -1) return null;
    const written = typeof note === 'string' && note.trim() ? note.trim() : null;
    items[index] = {
      ...items[index], verdict, gradedBy, gradedAt: at,
      note: written ?? items[index].note ?? null,
    };
    return items[index];
  }

  async listPending() {
    return [...this.#items.values()].flat().filter((i) => !i.verdict);
  }

  async listForLearner(learnerId, { limit = 20 } = {}) {
    return [...this.#items.values()]
      .flat()
      .filter((i) => i.learnerId === learnerId && (i.verdict === 'correct' || i.verdict === 'incorrect'))
      .sort((a, b) => String(b.gradedAt ?? '').localeCompare(String(a.gradedAt ?? '')))
      .slice(0, limit);
  }
}

/**
 * A renderer that produces a real (tiny) PDF buffer and echoes back what it was
 * told, so a test can assert the token values reached the page without owning a
 * layout engine.
 */
export class FakeDocumentRenderer extends IDocumentRenderer {
  constructor({ formMapFor = null, pageCount = 2 } = {}) {
    super();
    this.calls = [];
    this.formMapFor = formMapFor;
    this.pageCount = pageCount;
  }

  async render(document, opts = {}) {
    this.calls.push({ document, opts });
    const body = JSON.stringify({ id: document.id, seed: document.seed, variant: opts.variant ?? document.variant, tokens: opts.tokens ?? {} });
    return {
      pdf: Buffer.from(`%PDF-1.4\n${body}\n/Type /Page\n/Type /Page\n%%EOF`),
      pageCount: this.pageCount,
      formMap: this.formMapFor ? this.formMapFor(document, opts) : null,
    };
  }
}

/** Turns a receipt document into the ESC/POS item list the thermal port takes. */
export class FakeReceiptRenderer extends IReceiptRenderer {
  constructor() { super(); this.calls = []; }

  render(document) {
    this.calls.push(document);
    const items = document.blocks.map((block) => (block.type === 'scan_action'
      ? { type: 'barcode', content: block.action, label: block.label }
      : { type: 'text', content: block.md ?? '' }));
    // The real renderer prints a titled document's standard header first —
    // uppercased, inverted (DocumentEscPosRenderer). Transcripts assert on it.
    if (typeof document.title === 'string' && document.title.trim()) {
      items.unshift({ type: 'text', content: ` ${document.title.trim().toUpperCase()} ` });
    }
    // A scan action must print its LABEL as well as its barcode, or the child
    // holds a page of unlabelled stripes.
    const withLabels = items.flatMap((item) => (item.type === 'barcode'
      ? [{ type: 'text', content: item.label }, { type: 'barcode', content: item.content }]
      : [item]));
    return { items: withLabels, footer: { paddingLines: 3, autoCut: true } };
  }
}

/** Laser printer double with the real adapter's `printPdf` contract. */
export class FakeLaserPrinter {
  constructor() { this.jobs = []; this.fault = null; }

  setFault(fault) { this.fault = fault; }

  async printPdf(pdf, opts = {}) {
    if (this.fault === 'offline') {
      const err = new Error('raw print failed: connect ECONNREFUSED');
      err.code = 'PRINT_SEND_FAILED';
      throw err;
    }
    this.jobs.push({ pdf, opts });
    return { ok: true, bytes: pdf.length, copies: opts.copies ?? 1 };
  }

  async getStatus() { return { state: this.fault ? 'stopped' : 'idle', stateReasons: [], accepting: !this.fault }; }
  async ping() { return this.fault !== 'offline'; }
}

/** Thermal printer double: `print` resolves FALSE on failure, never rejects. */
export class FakeReceiptPrinter {
  constructor() { this.jobs = []; this.fault = null; }

  setFault(fault) { this.fault = fault; }

  async print(job) {
    if (this.fault === 'offline') return false;
    this.jobs.push(job);
    return true;
  }

  /** Test-only: the plain text a child would read off the last receipt. */
  lastTranscript() {
    const job = this.jobs[this.jobs.length - 1];
    if (!job) return null;
    return job.items.map((i) => String(i.content ?? '')).join('\n');
  }

  transcripts() {
    return this.jobs.map((job) => job.items.map((i) => String(i.content ?? '')).join('\n'));
  }
}

/** Playback double with the dispatch/complete surface the media leg needs. */
export class FakePlayback {
  constructor() { this.dispatches = []; this.seq = 0; }

  dispatch({ target, contentId, learnerId = null, durationSec = 0 }) {
    const record = {
      dispatchId: `dsp_${++this.seq}`, target, contentId, learnerId,
      durationSec, positionSec: 0, status: 'playing',
    };
    this.dispatches.push(record);
    return { ...record };
  }

  getDispatch(dispatchId) {
    const found = this.dispatches.find((d) => d.dispatchId === dispatchId);
    return found ? { ...found } : null;
  }
}

/**
 * Economy double with `earn`'s real return shape plus the txn id.
 *
 * It deliberately has NO replay guard of its own. The real service's guard reads
 * one UTC day's ledger shard and therefore pays the same ref again tomorrow —
 * which is precisely the gap School's durable outcome record exists to close.
 * A double that quietly deduplicated would hide the bug the guard prevents.
 */
export class FakeEconomy {
  constructor({ reward = 5, throwOn = null } = {}) {
    this.calls = [];
    this.reward = reward;
    this.throwOn = throwOn;
    this.seq = 0;
  }

  /** Mirrors `EconomyService.earn`: an explicit `amount` overrides the policy's. */
  async earn(userId, { action, source, ref = null, amount = null }) {
    this.calls.push({ userId, action, source, ref, amount });
    if (this.throwOn) throw Object.assign(new Error(this.throwOn), { name: 'ValidationError' });
    const earned = Number.isInteger(amount) && amount > 0 ? amount : this.reward;
    return { userId, earned, capped: false, duplicate: false, txnId: `txn_${++this.seq}`, balance: earned };
  }
}
