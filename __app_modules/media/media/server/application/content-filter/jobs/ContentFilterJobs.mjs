/**
 * Content-filter pipeline runs (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Build it"). Sequences the existing `contentfilter` CLI commands; never forks their logic.
 *
 * Heavy lane: one run at a time, FIFO, at most one queued-or-running run per film.
 * Light lane: audits, one at a time, debounced per film, never waiting on a heavy run.
 * executor 'worker': this process only queues and reports; the filter worker claims and runs
 * (Task 9, owner ruling 2026-11-07). executor 'inline': runs here.
 */
export class JobConflict extends Error {
  constructor(message = 'This film already has a run queued or running.') { super(message); this.name = 'JobConflict'; this.status = 409; }
}

export const STEP_TIMEOUT_MS = { preflight: 60e3, export: 5 * 60e3, refine: 6 * 3600e3, scenes: 2 * 3600e3, audit: 2 * 60e3 };
export const STAGES = ['export', 'refine', 'scenes', 'cards', 'audit'];
const WRITING = new Set(['export', 'refine', 'scenes']);
const OPEN = new Set(['queued', 'running']);
const TAIL = 500;

export class ContentFilterJobs {
  #store; #cli; #film; #digestOf; #draftCards; #clearNudges; #logPath; #logger; #now; #executor; #debounceMs; #schedule;
  #queue = []; #heavy = null; #audits = new Map(); #auditChain = Promise.resolve(); #locks = new Map(); #settled = new Set();

  constructor({ store, cli, film, digestOf, draftCards = null, clearNudges = async () => {}, logPath = () => null,
    logger = console, now = () => new Date(), executor = 'worker', auditDebounceMs = 2000, schedule }) {
    if (!store || !cli || !film || !digestOf || !schedule) throw new Error('ContentFilterJobs requires store, cli, film, digestOf and schedule');
    /** schedule(fn, ms): the composition's timer (application code holds no global timers). */
    this.#schedule = schedule;
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
      const rec = (await this.#store.load(rk)) || { ratingKey: rk, runs: [] };
      const out = await fn(rec);
      await this.#store.save(rk, rec);
      return out;
    } finally { release(); }
  }

  async enqueue({ ratingKey, kind, cues = null, stage = null, by = null }) {
    const rk = String(ratingKey);
    if (!['make', 'send-back', 'stage'].includes(kind)) throw Object.assign(new Error(`Unknown run kind: ${kind}`), { status: 400 });
    if (kind === 'stage' && !STAGES.includes(stage)) throw Object.assign(new Error(`Unknown stage: ${stage}`), { status: 400 });
    if (kind === 'send-back' && !(Array.isArray(cues) && cues.length)) throw Object.assign(new Error('send-back needs cue ids'), { status: 400 });
    const run = await this.#withRecord(rk, (rec) => {
      if (rec.runs.some((r) => OPEN.has(r.status))) throw new JobConflict();
      const at = this.#now().toISOString();
      const r = { id: `${at.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`, kind,
        ...(cues ? { cues } : {}), ...(stage ? { stage } : {}), status: 'queued', step: null, steps: [], requestedBy: by, queuedAt: at };
      rec.runs.push(r);
      return r;
    });
    this.#logger.info?.('content-filter.job.queued', { ratingKey: rk, runId: run.id, kind, stage, cues: cues?.length ?? null, by });
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
    if (run.kind === 'send-back') return ['refine', 'audit'];
    if (run.kind === 'stage') return run.stage === 'audit' ? ['audit'] : [run.stage, 'audit'];
    return ['preflight', 'export', 'refine', 'scenes', 'cards', 'audit'];
  }

  /** Run the film's queued run (the worker calls this after claiming). */
  async runNext(rk) {
    const run = await this.#withRecord(rk, (rec) => {
      const r = rec.runs.find((x) => x.status === 'queued');
      if (r) Object.assign(r, { status: 'running', startedAt: this.#now().toISOString(), log: this.#logPath(rk, r.id) });
      return r ? structuredClone(r) : null;
    });
    if (!run) return null;
    this.#logger.info?.('content-filter.job.started', { ratingKey: rk, runId: run.id, kind: run.kind });
    if (run.kind === 'send-back') await this.#clearNudges(rk, run.cues);
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
    const r = await this.#cli.run(command, args, { logPath: this.#logPath(rk, run.id), timeoutMs: STEP_TIMEOUT_MS[command] ?? 0 });
    return r.code === 0 ? { status: 'done', stdout: r.stdout } : { status: 'failed', error: r.stderrTail || `exit ${r.code}` };
  }

  async #runStep(rk, run, name) {
    const film = name === 'export' || name === 'scenes' ? await this.#film(rk) : null;
    switch (name) {
      case 'preflight': return this.#cliStep(rk, run, 'preflight', [rk]);
      case 'export':
        if (run.kind === 'make' && film?.hasEdl) return { status: 'skipped' };
        return this.#cliStep(rk, run, 'export', film?.exportArgs || [rk]);
      case 'refine': return this.#cliStep(rk, run, 'refine', run.kind === 'send-back' ? [rk, '--cues', run.cues.join(','), '--write'] : [rk, '--write']);
      case 'scenes':
        if (run.kind === 'make' && film?.hasScenes) return { status: 'skipped' };
        return this.#cliStep(rk, run, 'scenes', [rk, '--write']);
      case 'cards': {
        if (!this.#draftCards) return { status: 'skipped', note: 'No card writer configured' };
        const r = await this.#draftCards(rk);
        return { status: 'done', note: `${r?.drafted ?? 0} drafted` };
      }
      case 'audit': return (await this.#audit(rk, run)) ? { status: 'done' } : { status: 'failed', error: this.#lastAuditError };
      default: return { status: 'failed', error: `Unknown step ${name}` };
    }
  }

  #lastAuditError = null;

  async #audit(rk, run = null) {
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

  async state() {
    const running = []; const queued = [];
    for (const rec of await this.#store.list()) {
      for (const r of rec.runs || []) {
        if (r.status === 'running') running.push({ ratingKey: String(rec.ratingKey), runId: r.id, step: r.step });
        if (r.status === 'queued') queued.push({ ratingKey: String(rec.ratingKey), runId: r.id, queuedAt: r.queuedAt });
      }
    }
    queued.sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
    return { running, queued };
  }

  /** True while a run's export, refine or scenes step is writing this film's files. */
  async busyWriting(ratingKey) {
    const rec = await this.#store.load(String(ratingKey));
    return !!rec?.runs?.some((r) => r.status === 'running' && WRITING.has(r.step));
  }

  record(ratingKey) { return this.#store.load(String(ratingKey)); }

  onSettled(fn) { this.#settled.add(fn); return () => this.#settled.delete(fn); }

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
