/**
 * Content-filter pipeline runs (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Build it"). Sequences the existing `contentfilter` CLI commands; never forks their logic.
 *
 * Heavy lane: one run at a time, FIFO, at most one queued-or-running run per film.
 * Light lane: audits, one at a time, debounced per film, never waiting on a heavy run.
 * executor 'worker': this process only queues and reports; the filter worker claims and runs
 * (Task 9, owner ruling 2026-11-07). executor 'inline': runs here.
 */
import { foldProgress, parseRefineLine } from '../../../domain/content-filter/refine/refineProgress.mjs';

const PROGRESS_MIN_MS = 2000;
const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100000, Math.floor(Number(v)))) : null);
const str = (v, n = 80) => (v == null ? null : String(v).slice(0, n));
/** A worker's refine progress (refineProgress.mjs foldProgress), kept to known fields and bounded sizes. */
function cleanProgress(p) {
  return {
    phase: str(p.phase, 20), done: int(p.done) ?? 0, total: int(p.total), firstAt: str(p.firstAt, 40), at: str(p.at, 40),
    recent: (Array.isArray(p.recent) ? p.recent : []).slice(0, 8).map((o) => ({ cue: str(o?.cue), kind: str(o?.kind, 20), status: str(o?.status, 20), detail: str(o?.detail) })),
  };
}

export class JobConflict extends Error {
  constructor(message = 'This film already has a run queued or running.') { super(message); this.name = 'JobConflict'; this.status = 409; }
}

export const STEP_TIMEOUT_MS = { preflight: 60e3, export: 5 * 60e3, refine: 6 * 3600e3, scenes: 2 * 3600e3, audit: 2 * 60e3 };
export const STAGES = ['export', 'refine', 'scenes', 'cards', 'audit'];
export const HEARTBEAT_MS = 20e3;
export const STALE_MS = 60e3;
export const WATCH_MS = 10e3;
export const WORKER_ALIVE_MS = 30e3;
const WRITING = new Set(['export', 'refine', 'scenes']);
const LIGHT_STAGES = new Set(['audit', 'cards']);
/** Steps the app always runs itself (no Python): after a remote worker's results land. */
const APP_STEPS = new Set(['cards', 'audit']);
const OPEN = new Set(['queued', 'running']);
const TAIL = 500;

export class ContentFilterJobs {
  #store; #cli; #film; #digestOf; #draftCards; #clearNudges; #logPath; #logger; #now; #executor; #debounceMs; #schedule; #inputsOf; #applyResults;
  #queue = []; #heavy = null; #audits = new Map(); #auditChain = Promise.resolve(); #locks = new Map(); #settled = new Set(); #audited = new Set(); #auditing = new Set();

  constructor({ store, cli, film, digestOf, draftCards = null, clearNudges = async () => {}, logPath = () => null,
    logger = console, now = () => new Date(), executor = 'worker', auditDebounceMs = 2000, schedule,
    inputsOf = async () => null, applyResults = async () => {} }) {
    if (!store || !cli || !film || !digestOf || !schedule) throw new Error('ContentFilterJobs requires store, cli, film, digestOf and schedule');
    /** schedule(fn, ms): the composition's timer (application code holds no global timers). */
    this.#schedule = schedule;
    /** Remote worker: what a claimed run gets (inputsOf) and how its results are saved (applyResults). */
    this.#inputsOf = inputsOf; this.#applyResults = applyResults;
    this.#store = store; this.#cli = cli; this.#film = film; this.#digestOf = digestOf; this.#draftCards = draftCards;
    this.#clearNudges = clearNudges; this.#logPath = logPath; this.#logger = logger; this.#now = now;
    this.#executor = executor; this.#debounceMs = auditDebounceMs;
  }

  /** Serialise read-modify-write of one film's record across the two lanes. */
  async #withRecord(rk, fn) {
    const prev = this.#locks.get(rk) || Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    this.#locks.set(rk, prev.then(() => mine));
    await prev;
    try {
      // Across processes (app and worker) the store's own lock; in-process the chain above.
      if (typeof this.#store.update === 'function') return await this.#store.update(rk, fn);
      const rec = (await this.#store.load(rk)) || { ratingKey: rk, runs: [] };
      const out = await fn(rec);
      await this.#store.save(rk, rec);
      return out;
    } finally { release(); }
  }

  async enqueue({ ratingKey, kind, cues = null, stage = null, reasons = null, by = null }) {
    const rk = String(ratingKey);
    if (!['make', 'send-back', 'stage'].includes(kind)) throw Object.assign(new Error(`Unknown run kind: ${kind}`), { status: 400 });
    if (kind === 'stage' && !STAGES.includes(stage)) throw Object.assign(new Error(`Unknown stage: ${stage}`), { status: 400 });
    if (kind === 'send-back' && !(Array.isArray(cues) && cues.length)) throw Object.assign(new Error('send-back needs cue ids'), { status: 400 });
    const run = await this.#withRecord(rk, (rec) => {
      if (rec.runs.some((r) => OPEN.has(r.status))) throw new JobConflict();
      const at = this.#now().toISOString();
      const r = { id: `${at.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`, kind,
        ...(cues ? { cues } : {}), ...(stage ? { stage } : {}), ...(reasons && Object.keys(reasons).length ? { reasons } : {}), status: 'queued', step: null, steps: [], requestedBy: by, queuedAt: at };
      rec.runs.push(r);
      return r;
    });
    this.#logger.info?.('content-filter.job.queued', { ratingKey: rk, runId: run.id, kind, stage, cues: cues?.length ?? null, reasons: reasons ? Object.keys(reasons).length : 0, by });
    // Audit and card drafts need no Python: they run here at once, whoever executes heavy runs.
    if (kind === 'stage' && LIGHT_STAGES.has(stage)) {
      this.runNext(rk).catch((e) => this.#logger.warn?.('content-filter.job.crashed', { ratingKey: rk, error: e.message }));
      return run;
    }
    this.#queue.push(rk);
    this.#kick();
    return run;
  }

  #kick() {
    if (this.#executor !== 'inline' || this.#heavy || !this.#queue.length) return;
    const rk = this.#queue.shift();
    this.#heavy = this.runNext(rk).catch((e) => this.#logger.warn?.('content-filter.job.crashed', { ratingKey: rk, error: e.message }))
      .finally(() => { this.#heavy = null; this.#kick(); });
  }

  #plan(run) {
    // Every run that spawns pipeline work checks the machine first (preflight writes nothing).
    if (run.kind === 'send-back') return ['preflight', 'refine', 'audit'];
    if (run.kind === 'stage') return run.stage === 'audit' ? ['audit'] : run.stage === 'cards' ? ['cards', 'audit'] : ['preflight', run.stage, 'audit'];
    return ['preflight', 'export', 'refine', 'scenes', 'cards', 'audit'];
  }

  /** Run the film's queued run (the worker calls this after claiming, with its owner id). */
  async runNext(rk, { owner = null } = {}) {
    const run = await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.status === 'queued');
      const at = this.#now().toISOString();
      if (r) Object.assign(r, { status: 'running', startedAt: at, log: this.#logPath(rk, r.id), ...(owner ? { worker: owner, heartbeatAt: at } : {}) });
      return r ? structuredClone(r) : null;
    });
    if (!run) return null;
    let beating = !!owner;
    const beat = () => {
      if (!beating) return;
      this.#withRecord(rk, (rec) => { const r = rec.runs.find((x) => x.id === run.id); if (r && r.status === 'running') r.heartbeatAt = this.#now().toISOString(); })
        .catch(() => {}).finally(() => this.#schedule(beat, HEARTBEAT_MS));
    };
    if (owner) this.#schedule(beat, HEARTBEAT_MS);
    try { return await this.#runSteps(rk, run); } finally { beating = false; }
  }

  async #runSteps(rk, run) {
    this.#logger.info?.('content-filter.job.started', { ratingKey: rk, runId: run.id, kind: run.kind });
    let failed = null;
    for (const name of this.#plan(run)) {
      await this.#step(rk, run.id, { name, status: 'running', startedAt: this.#now().toISOString() });
      let result;
      try { result = await this.#runStep(rk, run, name); } catch (e) { result = { status: 'failed', error: e.message }; }
      const entry = { name, status: result.status, startedAt: undefined, endedAt: this.#now().toISOString(),
        ...(result.error ? { error: String(result.error).slice(-TAIL) } : {}), ...(result.note ? { note: result.note } : {}) };
      await this.#step(rk, run.id, entry);
      this.#logger.info?.('content-filter.job.step', { ratingKey: rk, runId: run.id, step: name, status: result.status });
      if (result.status === 'failed') { failed = { step: name, error: entry.error }; break; }
    }
    await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.id === run.id);
      if (r) Object.assign(r, { status: failed ? 'failed' : 'done', endedAt: this.#now().toISOString(), ...(failed ? { step: failed.step } : {}) });
    });
    if (failed) this.#logger.warn?.('content-filter.job.failed', { ratingKey: rk, runId: run.id, ...failed });
    else this.#logger.info?.('content-filter.job.done', { ratingKey: rk, runId: run.id });
    for (const fn of this.#settled) { try { fn({ ratingKey: rk, runId: run.id, status: failed ? 'failed' : 'done' }); } catch { /* listener */ } }
    return run.id;
  }

  async #step(rk, runId, entry) {
    await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.id === runId);
      if (!r) return;
      r.step = entry.name;
      const i = r.steps.findIndex((s) => s.name === entry.name);
      if (i < 0) r.steps.push(entry);
      else r.steps[i] = { ...r.steps[i], ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) };
    });
  }

  async #cliStep(rk, run, command, args) {
    // Inline refine reports its measured count like the worker does (workerCommand.mjs).
    let prog = null; let sentAt = -Infinity;
    const onLine = command !== 'refine' ? null : (line) => {
      const parsed = parseRefineLine(line);
      if (!parsed) return;
      const phaseChanged = parsed.phase !== prog?.phase;
      const t = this.#now().getTime();
      prog = foldProgress(prog, parsed, new Date(t).toISOString());
      const edge = parsed.phase === 'measure' && (parsed.done === 1 || parsed.done === parsed.total);
      if (!phaseChanged && !edge && t - sentAt < PROGRESS_MIN_MS) return;
      sentAt = t;
      this.#step(rk, run.id, { name: 'refine', progress: cleanProgress(prog) }).catch(() => {});
    };
    const r = await this.#cli.run(command, args, { logPath: this.#logPath(rk, run.id), timeoutMs: STEP_TIMEOUT_MS[command] ?? 0, ...(onLine ? { onLine } : {}) });
    return r.code === 0 ? { status: 'done', stdout: r.stdout } : { status: 'failed', error: r.stderrTail || `exit ${r.code}` };
  }

  async #runStep(rk, run, name) {
    const film = name === 'export' || name === 'scenes' ? await this.#film(rk) : null;
    switch (name) {
      case 'preflight': return this.#cliStep(rk, run, 'preflight', [rk]);
      case 'export':
        if (run.kind === 'make' && film?.hasEdl) return { status: 'skipped' };
        return this.#cliStep(rk, run, 'export', film?.exportArgs || [rk]);
      case 'refine':
        // A send-back drops the hand fix only once the run can actually measure again.
        if (run.kind === 'send-back') await this.#clearNudges(rk, run.cues);
        return this.#cliStep(rk, run, 'refine', run.kind === 'send-back' ? [rk, '--cues', run.cues.join(','), '--write'] : [rk, '--write']);
      case 'scenes':
        if (run.kind === 'make' && film?.hasScenes) return { status: 'skipped' };
        return this.#cliStep(rk, run, 'scenes', [rk, '--write']);
      case 'cards': {
        // The worker has no card writer: the app drafts them when it sees the run settle (watchOnce).
        if (!this.#draftCards) return { status: 'skipped', note: run.worker ? 'worker' : 'No card writer configured' };
        const r = await this.#draftCards(rk);
        return { status: 'done', note: `${r?.drafted ?? 0} drafted` };
      }
      case 'audit': return (await this.#audit(rk, run)) ? { status: 'done' } : { status: 'failed', error: this.#lastAuditError };
      default: return { status: 'failed', error: `Unknown step ${name}` };
    }
  }

  #lastAuditError = null;

  /** Is an audit queued or running for this film right now (this process)? */
  isAuditing(ratingKey) { const rk = String(ratingKey); return this.#audits.has(rk) || this.#auditing.has(rk); }

  async #audit(rk, run = null) {
    this.#auditing.add(rk);
    try { return await this.#auditNow(rk, run); } finally { this.#auditing.delete(rk); }
  }

  async #auditNow(rk, run) {
    const digest = await this.#digestOf(rk);
    const r = await this.#cli.run('audit', [rk, '--json'], { logPath: run ? this.#logPath(rk, run.id) : null, timeoutMs: STEP_TIMEOUT_MS.audit });
    let report = null;
    try { report = JSON.parse(r.stdout); } catch { /* below */ }
    if (!report) { this.#lastAuditError = r.stderrTail || `audit exit ${r.code}`; return false; }
    const failures = Object.entries(report.checks || {}).filter(([, c]) => c && c.ok === false).map(([k]) => k);
    await this.#withRecord(rk, (rec) => {
      rec.audit = { ok: report.ok === true, at: this.#now().toISOString(), digest, level: report.certification?.level ?? 'none',
        ...(report.certification?.blocking ? { blocking: report.certification.blocking } : {}), rows: report.rows || [], failures };
    });
    this.#logger.info?.('content-filter.audit.stored', { ratingKey: rk, ok: report.ok === true, rows: (report.rows || []).length });
    for (const fn of this.#audited) { try { await fn(rk); } catch (e) { this.#logger.warn?.('content-filter.audit.listener', { ratingKey: rk, error: e.message }); } }
    return true;
  }

  /** Light lane: re-audit a film (after a ruling), debounced; resolves when stored. */
  audit(ratingKey) {
    const rk = String(ratingKey);
    const pending = this.#audits.get(rk);
    if (pending) return pending.promise;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    this.#audits.set(rk, { promise });
    this.#schedule(() => {
      this.#auditChain = this.#auditChain.then(async () => {
        this.#audits.delete(rk);
        try { resolve(await this.#audit(rk)); } catch (e) {
          this.#logger.warn?.('content-filter.audit.failed', { ratingKey: rk, error: e.message }); resolve(false);
        }
      });
    }, this.#debounceMs);
    return promise;
  }

  /**
   * Stop a queued or running run (Admin "Stop"). It settles as `cancelled` at once, so the queue and
   * the deploy gate drop it; a worker running it is refused at its next report and kills its step.
   * What the run measured before it stopped stays in its stage folder only: nothing is applied.
   */
  async cancel({ ratingKey, runId, by = null }) {
    const rk = String(ratingKey);
    const run = await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.id === runId);
      if (!r) throw Object.assign(new Error('No such run.'), { status: 404 });
      if (!OPEN.has(r.status)) throw new JobConflict('This run has already finished.');
      Object.assign(r, { status: 'cancelled', endedAt: this.#now().toISOString(), cancelledBy: by });
      return structuredClone(r);
    });
    this.#queue = this.#queue.filter((x) => x !== rk);
    this.#logger.info?.('content-filter.job.cancelled', { ratingKey: rk, runId, step: run.step, by });
    for (const fn of this.#settled) { try { fn({ ratingKey: rk, runId, status: 'cancelled' }); } catch { /* listener */ } }
    return run;
  }

  /** On boot: runs that were in flight or waiting are interrupted; nothing restarts on its own. */
  async recover() {
    for (const rec of await this.#store.list()) {
      const rk = String(rec.ratingKey);
      const hit = await this.#withRecord(rk, (r) => {
        const open = r.runs.filter((x) => OPEN.has(x.status));
        for (const x of open) Object.assign(x, { status: 'interrupted', endedAt: this.#now().toISOString() });
        return open.map((x) => ({ runId: x.id, step: x.step }));
      });
      for (const h of hit) this.#logger.warn?.('content-filter.job.interrupted', { ratingKey: rk, ...h });
    }
  }

  // ── Remote filter worker (talks to the app over HTTP; never touches the data folders) ──

  /** Claim the oldest queued run for `owner`: { ratingKey, run, steps, inputs } or null. */
  async claimRemote({ owner }) {
    this.#workerSeen = { owner, at: this.#now().getTime() };
    const rk = await this.claimNext(owner);
    if (!rk) return null;
    const film = await this.#film(rk);
    const run = await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.status === 'queued');
      if (!r) return null;
      const at = this.#now().toISOString();
      Object.assign(r, { status: 'running', startedAt: at, worker: owner, heartbeatAt: at, step: 'claimed', remote: true });
      if (r.kind === 'make' && film?.hasEdl) r.steps.push({ name: 'export', status: 'skipped', endedAt: at });
      if (r.kind === 'make' && film?.hasScenes) r.steps.push({ name: 'scenes', status: 'skipped', endedAt: at });
      return structuredClone(r);
    });
    if (!run) return null;
    const skipped = new Set(run.steps.map((x) => x.name));
    const steps = this.#plan(run).filter((n) => !APP_STEPS.has(n) && !skipped.has(n));
    this.#logger.info?.('content-filter.job.started', { ratingKey: rk, runId: run.id, kind: run.kind, worker: owner, remote: true });
    return { ratingKey: rk, run, steps, ...(film?.exportArgs ? { exportArgs: film.exportArgs } : {}), inputs: await this.#inputsOf(rk) };
  }

  #workerSeen = null;

  /** Is a filter worker serving the queue? An idle worker asks for work every few seconds. */
  workerStatus() {
    const w = this.#workerSeen;
    if (!w) return { alive: false, owner: null, seenAt: null };
    return { alive: this.#now().getTime() - w.at < WORKER_ALIVE_MS, owner: w.owner, seenAt: new Date(w.at).toISOString() };
  }

  async #mine(rk, runId, owner, fn) {
    this.#workerSeen = { owner, at: this.#now().getTime() };
    return this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.id === runId);
      if (!r || r.status !== 'running' || r.worker !== owner) throw new JobConflict('This run is no longer yours.');
      r.heartbeatAt = this.#now().toISOString();
      return fn(r);
    });
  }

  /** Heartbeat, optionally with a step entry ({ name, status, error?, note? }). */
  async progress({ ratingKey, runId, owner, step = null }) {
    const rk = String(ratingKey);
    await this.#mine(rk, runId, owner, (r) => {
      if (!step?.name) return;
      r.step = String(step.name);
      const i = r.steps.findIndex((x) => x.name === r.step);
      const running = (step.status || 'running') === 'running';
      const entry = { name: r.step, status: step.status || 'running', ...(step.error ? { error: String(step.error).slice(-TAIL) } : {}), ...(step.note ? { note: String(step.note) } : {}),
        // A step already running keeps its start: progress reports come every few seconds.
        ...(running ? (i >= 0 && r.steps[i].status === 'running' ? {} : { startedAt: this.#now().toISOString() }) : { endedAt: this.#now().toISOString() }),
        ...(step.progress && typeof step.progress === 'object' ? { progress: cleanProgress(step.progress) } : {}) };
      if (i < 0) r.steps.push(entry); else r.steps[i] = { ...r.steps[i], ...entry };
    });
    if (step?.name) this.#logger.info?.('content-filter.job.step', { ratingKey: rk, runId, step: step.name, status: step.status, remote: true });
  }

  /** The worker is done: save its results, run cards and the audit here, settle the run. */
  async complete({ ratingKey, runId, owner, status, step = null, error = null, results = null }) {
    const rk = String(ratingKey);
    const run = await this.#mine(rk, runId, owner, (r) => structuredClone(r));
    let failed = status === 'done' ? null : { step: step || run.step, error: String(error || 'The filter worker reported a failure.').slice(-TAIL) };
    if (!failed) {
      try { await this.#applyResults(rk, results || {}); } catch (e) { failed = { step: 'save', error: e.message }; }
    }
    if (!failed) {
      for (const name of this.#plan(run).filter((n) => APP_STEPS.has(n))) {
        await this.#step(rk, run.id, { name, status: 'running', startedAt: this.#now().toISOString() });
        let res;
        try { res = await this.#runStep(rk, run, name); } catch (e) { res = { status: 'failed', error: e.message }; }
        await this.#step(rk, run.id, { name, status: res.status, endedAt: this.#now().toISOString(), ...(res.error ? { error: String(res.error).slice(-TAIL) } : {}), ...(res.note ? { note: res.note } : {}) });
        if (res.status === 'failed') { failed = { step: name, error: res.error }; break; }
      }
    }
    await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.id === run.id);
      if (!r) return;
      Object.assign(r, { status: failed ? 'failed' : 'done', endedAt: this.#now().toISOString(), cardsDrafted: true });
      if (failed) {
        r.step = failed.step;
        const i = r.steps.findIndex((x) => x.name === failed.step);
        const entry = { name: failed.step, status: 'failed', error: failed.error, endedAt: this.#now().toISOString() };
        if (i < 0) r.steps.push(entry); else r.steps[i] = { ...r.steps[i], ...entry };
      }
    });
    if (failed) this.#logger.warn?.('content-filter.job.failed', { ratingKey: rk, runId: run.id, ...failed, remote: true });
    else this.#logger.info?.('content-filter.job.done', { ratingKey: rk, runId: run.id, remote: true });
    for (const fn of this.#settled) { try { fn({ ratingKey: rk, runId: run.id, status: failed ? 'failed' : 'done' }); } catch { /* listener */ } }
    return { status: failed ? 'failed' : 'done' };
  }

  /** Worker: claim the oldest queued run (atomic across workers via store.claim). Returns its film or null. */
  async claimNext(owner) {
    const { running, queued } = await this.state();
    const busy = new Set(running.map((r) => r.ratingKey));
    for (const q of queued) {
      if (busy.has(q.ratingKey) || (q.kind === 'stage' && LIGHT_STAGES.has(q.stage))) continue; // the app runs those
      if (typeof this.#store.claim === 'function' && !(await this.#store.claim(q.ratingKey, q.runId, owner))) continue;
      this.#logger.info?.('content-filter.job.claimed', { ratingKey: q.ratingKey, runId: q.runId, worker: owner });
      return q.ratingKey;
    }
    return null;
  }

  /** Worker runs whose heartbeat stopped (the worker died) become interrupted. Returns how many. */
  async reapStale({ maxAgeMs = STALE_MS } = {}) {
    const now = this.#now().getTime(); let n = 0;
    for (const rec of await this.#store.list()) {
      const rk = String(rec.ratingKey);
      const stale = (r) => r.status === 'running' && r.worker && (!r.heartbeatAt || now - Date.parse(r.heartbeatAt) > maxAgeMs);
      if (!(rec.runs || []).some(stale)) continue;
      n += await this.#withRecord(rk, (r) => {
        const hit = r.runs.filter(stale);
        for (const x of hit) {
          Object.assign(x, { status: 'interrupted', endedAt: this.#now().toISOString() });
          this.#logger.warn?.('content-filter.job.interrupted', { ratingKey: rk, runId: x.id, step: x.step, worker: x.worker, reason: 'heartbeat' });
        }
        return hit.length;
      });
    }
    return n;
  }

  #seen = null; // runId -> status, and rk -> audit.at, from the last watch tick

  /**
   * App side, worker mode: notice what the worker finished. Fires onSettled for runs that left
   * queued/running, onAudit for a newly stored audit, and drafts cards (then re-audits) for a
   * finished make run whose cards the worker skipped.
   */
  async watchOnce() {
    // A dead worker's run must not stay 'running' (it would pin the deploy gate).
    await this.reapStale();
    const first = this.#seen === null;
    const prev = this.#seen || new Map();
    const next = new Map();
    const settled = []; const audited = [];
    for (const rec of await this.#store.list()) {
      const rk = String(rec.ratingKey);
      for (const r of rec.runs || []) {
        next.set(`run:${r.id}`, r.status);
        const was = prev.get(`run:${r.id}`);
        if (!first && OPEN.has(was) && !OPEN.has(r.status)) settled.push({ rk, run: r });
      }
      if (rec.audit?.at) {
        next.set(`audit:${rk}`, rec.audit.at);
        if (!first && prev.get(`audit:${rk}`) !== rec.audit.at) audited.push(rk);
      }
    }
    this.#seen = next;
    for (const rk of audited) for (const fn of this.#audited) { try { await fn(rk); } catch { /* listener */ } }
    for (const { rk, run } of settled) {
      for (const fn of this.#settled) { try { fn({ ratingKey: rk, runId: run.id, status: run.status }); } catch { /* listener */ } }
    }
    // Cards the worker skipped, drafted once whenever the app sees them (also after an app restart).
    if (this.#draftCards) {
      for (const rec of await this.#store.list()) {
        const rk = String(rec.ratingKey);
        for (const run of rec.runs || []) {
          const skipped = run.steps?.some((x) => x.name === 'cards' && x.status === 'skipped' && x.note === 'worker');
          if (run.status !== 'done' || !skipped || run.cardsDrafted) continue;
          try {
            const r = await this.#draftCards(rk);
            await this.#withRecord(rk, (x) => { const y = x.runs.find((z) => z.id === run.id); if (y) y.cardsDrafted = true; });
            this.#logger.info?.('content-filter.job.cards', { ratingKey: rk, runId: run.id, drafted: r?.drafted ?? 0 });
            await this.audit(rk);
          } catch (e) { this.#logger.warn?.('content-filter.job.cards_failed', { ratingKey: rk, error: e.message }); }
        }
      }
    }
  }

  /** Poll watchOnce every WATCH_MS (app, worker mode). */
  watch({ intervalMs = WATCH_MS } = {}) {
    const tick = () => this.watchOnce().catch((e) => this.#logger.warn?.('content-filter.job.watch_failed', { error: e.message }))
      .finally(() => this.#schedule(tick, intervalMs));
    tick();
  }

  async state() {
    const running = []; const queued = [];
    for (const rec of await this.#store.list()) {
      for (const r of rec.runs || []) {
        if (r.status === 'running') running.push({ ratingKey: String(rec.ratingKey), runId: r.id, step: r.step });
        if (r.status === 'queued') queued.push({ ratingKey: String(rec.ratingKey), runId: r.id, queuedAt: r.queuedAt, kind: r.kind, ...(r.stage ? { stage: r.stage } : {}) });
      }
    }
    queued.sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
    return { running, queued, worker: this.workerStatus() };
  }

  /** True while a run's export, refine or scenes step is writing this film's files. */
  async busyWriting(ratingKey) {
    const rec = await this.#store.load(String(ratingKey));
    // A remote worker's run holds the film for its whole life: its results replace the files.
    return !!rec?.runs?.some((r) => r.status === 'running' && (WRITING.has(r.step) || r.remote));
  }

  record(ratingKey) { return this.#store.load(String(ratingKey)); }

  onSettled(fn) { this.#settled.add(fn); return () => this.#settled.delete(fn); }

  /** fn(ratingKey) after every stored audit (review marks are pruned against it). */
  onAudit(fn) { this.#audited.add(fn); return () => this.#audited.delete(fn); }

  /** Both lanes drained (tests, shutdown). */
  async idle() {
    for (;;) {
      const h = this.#heavy;
      await new Promise((r) => this.#schedule(r, Math.max(5, this.#debounceMs + 5)));
      await this.#auditChain;
      if (h) await h;
      if (!this.#heavy && !this.#queue.length && !this.#audits.size) return;
    }
  }
}
