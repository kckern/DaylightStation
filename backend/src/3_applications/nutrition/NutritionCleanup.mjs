import { sha256Text } from '#system/utils/sha256.mjs';
import { cleanupDates, entryKey } from '#domains/nutrition/services/cleanupPolicy.mjs';
import { AgentInteractions } from '#apps/agents/framework/AgentInteractions.mjs';
import { effectiveSettings, validateSettingsChange, blockedKinds, isPlain } from '#domains/nutrition/services/auditorPolicy.mjs';
import { snapshotDigest, classifyChange, onlyOwnChanges } from '#domains/nutrition/services/auditTrigger.mjs';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const terminal = new Set(['completed', 'failed', 'cancelled']);
const NESTED = ['triggers', 'permissions'];
const SETTINGS_LOG_LIMIT = 500;
const RUN_HISTORY_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();
const notPermitted = (proposal, permissions) => { if (blockedKinds(proposal, permissions).length) fail('Not permitted by auditor settings'); };
// Finished runs beyond the newest RUN_HISTORY_LIMIT are dropped, except one an
// unresolved question still points at: its answer is judged by that run's settings.
const pruneRuns = state => {
  const referenced = new Set(Object.values(state.questions || {}).filter(q => ['open', 'answering'].includes(q.status)).map(q => q.runId));
  const finished = Object.values(state.runs).filter(run => terminal.has(run.status))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  for (const run of finished.slice(RUN_HISTORY_LIMIT)) if (!referenced.has(run.id)) delete state.runs[run.id];
};
const questionExpired = (question, now, dates) => question.entryVersions.some(row => row.stabilizesAt
  ? !Number.isFinite(Date.parse(row.stabilizesAt)) || Date.parse(row.stabilizesAt) <= now : !dates.includes(row.date));

/** Durable dispatcher and application phase gates around read-only AI reasoning. */
export class NutritionCleanup {
  #active = new Map(); #dirty = new Map(); #started = new Set();
  constructor(deps) {
    Object.assign(this, deps);
    this.interactions = new AgentInteractions({ store: this.store, clock: this.clock, onAnswer: (userId, q) => this.#answer(userId, q) });
    this.runs.register({ id: 'nutrition-audit', execute: (input, context) => this.auditor.audit(input, context) });
  }
  status(userId) {
    const state = this.store.load(userId);
    const settings = effectiveSettings(state.settings);
    return { version: state.version, settings, nextEligibleAt: state.lastAutoRunAt ? iso(state.lastAutoRunAt + settings.minGapMinutes * 60000) : null,
      questions: Object.values(state.questions).filter(q => ['open', 'answering'].includes(q.status)).map(({ snapshot, evidence, prepared, ...question }) => question),
      runs: Object.values(state.runs).reverse().slice(0, 20).map(({ snapshot, result, ...run }) => run) };
  }
  async history(userId, { offset = 0, limit = 30 } = {}) {
    const ledger = await this.items.listCleanupAudit(userId, { offset: 0, limit: 100 });
    for (let page = 100; page < ledger.total; page += 100) ledger.records.push(...(await this.items.listCleanupAudit(userId, { offset: page, limit: 100 })).records);
    const logs = await this.foodLogs.findAll(userId, { includeArchives: true });
    const pending = logs.flatMap(log => Object.values(log.metadata?.cleanupAudit || {}).map(record => ({ ...record, logUuid: log.id })));
    const records = [...ledger.records, ...pending].sort((a, b) => b.at.localeCompare(a.at));
    return { records: records.slice(offset, offset + limit), total: ledger.total + pending.length };
  }
  async settings(userId, { expectedVersion, ...changes }) {
    validateSettingsChange(changes);
    this.store.update(userId, state => {
      if (state.version !== expectedVersion) fail('Settings changed. Reload first.');
      // Compare against what the auditor was actually using, so a first explicit
      // choice of a default value is not recorded as a change.
      const before = effectiveSettings(state.settings);
      const at = new Date(this.clock.now()).toISOString();
      const logged = [];
      const record = (field, from, to) => { if (from !== to) logged.push({ at, actor: 'user', field, from, to }); };
      for (const [key, value] of Object.entries(changes)) {
        if (!NESTED.includes(key)) { record(key, before[key], value); state.settings[key] = value; continue; }
        for (const [kind, on] of Object.entries(value)) record(key + '.' + kind, before[key][kind], on);
        state.settings[key] = { ...(isPlain(state.settings[key]) ? state.settings[key] : {}), ...value };
      }
      if (logged.length) state.settingsLog = [...(state.settingsLog || []), ...logged].slice(-SETTINGS_LOG_LIMIT);
      if (changes.enabled === false) for (const run of Object.values(state.runs)) if (!terminal.has(run.status)) run.status = 'cancelled';
    });
    if (changes.enabled === false) {
      for (const run of Object.values(this.store.load(userId).runs).filter(r => r.status === 'cancelled')) {
        try { await this.runs.cancel({ workflowId: 'nutrition-audit', userId, runId: run.id }); } catch { /* an undispatched run has no SDK state */ }
      }
    }
    return this.status(userId);
  }
  /** Who changed which auditor setting, newest first. */
  settingsLog(userId) { return [...(this.store.load(userId).settingsLog || [])].reverse(); }
  /**
   * Queue (or resume) an audit. `trigger` names why: ['manual'], ['dailySweep'],
   * or the change kinds tick classified. Automatic requests pass the trigger
   * filter and the daily spend cap first; manual ones only note being over cap.
   */
  async request(userId, { manual = false, reconcile = false, trigger } = {}) {
    const state = this.store.load(userId);
    if (!manual && !state.settings.enabled) return null;
    const existing = Object.values(state.runs).find(run => !terminal.has(run.status));
    if (existing) { this.#launch(userId, existing.id); return { runId: existing.id }; }
    this.auditor.refreshReferences?.();
    const snapshot = await this.auditor.snapshot(userId);
    if (!manual && !reconcile && state.checkedFingerprint === snapshot.fingerprint) return null;
    const settings = effectiveSettings(state.settings);
    const digest = this.#digest(snapshot);
    const kinds = manual ? ['manual'] : reconcile ? ['dailySweep']
      : trigger || (digest ? [...classifyChange(state.checkedDigest, digest)] : []);
    if (!manual && await this.#filtered(userId, snapshot, digest, kinds, settings)) return null;
    const spend = await this.#spend(userId, settings);
    if (!manual && spend.over) {
      const day = cleanupDates(this.clock.now(), this.timezoneFor(userId))[0];
      if (this.store.load(userId).lastCapDay !== day) {
        this.store.update(userId, current => { current.lastCapDay = day; });
        await this.#journal(userId, { at: iso(this.clock.now()), skipped: 'cap', spentUsd: spend.spentUsd, capUsd: settings.dailyCapUsd });
      }
      this.logger.info('nutrition.cleanup.capped', { userId, spentUsd: spend.spentUsd, capUsd: settings.dailyCapUsd });
      return null;
    }
    // Triage (NutritionAuditTriage): shadow records a verdict beside the run;
    // gate lets a clean verdict skip the LLM audit. Manual and daily
    // reconcile runs are never gated.
    const triage = !manual && this.triage?.active ? await this.triage.assess(snapshot) : null;
    if (triage && !triage.needsAudit && !reconcile && this.triage.gating) {
      this.store.update(userId, current => { current.checkedFingerprint = snapshot.fingerprint; current.checkedDigest = digest; });
      this.logger.info('nutrition.cleanup.skipped', { userId, fingerprint: snapshot.fingerprint, reason: triage.reason, score: triage.score });
      return null;
    }
    let id = 'audit_' + sha256Text(userId + snapshot.fingerprint + this.clock.now() + state.version).slice(0, 24);
    this.store.update(userId, current => {
      const queued = Object.values(current.runs).find(run => !terminal.has(run.status));
      if (queued) { id = queued.id; return; }
      if (!manual && !current.settings.enabled) { id = null; return; }
      // Model and permissions are fixed at queue time: a retried run must send
      // the managed-run store the identical input, and a settings change mid-run
      // must not change what the run may do.
      const settings = effectiveSettings(current.settings);
      if (!manual) current.lastAutoRunAt = this.clock.now();
      current.runs[id] = { id, status: 'queued', attempt: 0, snapshot, dryRun: settings.dryRun,
        model: settings.model, permissions: settings.permissions, trigger: kinds,
        createdAt: new Date(this.clock.now()).toISOString(), manual, ...(manual && spend.over ? { overCap: true } : {}),
        ...(triage ? { triage: { needsAudit: triage.needsAudit, reason: triage.reason, score: triage.score } } : {}) };
    });
    if (!id) return null;
    this.#launch(userId, id);
    return { runId: id };
  }
  /** Per-concern digest of a snapshot; null without an injected hash (fingerprint-only checks). */
  #digest(snapshot) { return this.hash ? snapshotDigest(snapshot, this.hash) : null; }
  /** Every kind that changed is switched off: count the snapshot as checked, note it once, run nothing. */
  async #filtered(userId, snapshot, digest, kinds, settings) {
    if (!kinds.length || kinds.some(kind => settings.triggers[kind] !== false)) return false;
    const noted = this.store.load(userId).lastFilteredFingerprint === snapshot.fingerprint;
    this.store.update(userId, state => {
      state.checkedFingerprint = snapshot.fingerprint; state.checkedDigest = digest; state.lastFilteredFingerprint = snapshot.fingerprint;
    });
    if (!noted) await this.#journal(userId, { at: iso(this.clock.now()), skipped: 'filtered', kinds });
    this.logger.info('nutrition.cleanup.filtered', { userId, kinds });
    return true;
  }
  /** Today's (household day) auditor spend from the journal, against the cap. No journal or no cap: never over. */
  async #spend(userId, settings) {
    if (!this.journal || settings.dailyCapUsd == null) return { over: false, spentUsd: null };
    const now = this.clock.now(), tz = this.timezoneFor(userId);
    const today = cleanupDates(now, tz)[0];
    let rows;
    try { rows = await this.journal.list(userId, { from: iso(now - 2 * DAY_MS), to: iso(now + DAY_MS) }); }
    catch (error) { this.logger.warn('nutrition.cleanup.journal_read_failed', { userId, error: error.message }); return { over: false, spentUsd: null }; }
    const spentUsd = rows.filter(row => Number.isFinite(row.costUsd) && cleanupDates(Date.parse(row.at), tz)[0] === today)
      .reduce((sum, row) => sum + row.costUsd, 0);
    return { over: spentUsd >= settings.dailyCapUsd, spentUsd: Math.round(spentUsd * 1e6) / 1e6 };
  }
  /** The journal is a record, not a gate: a failed write is logged and the run carries on. */
  async #journal(userId, row) {
    if (!this.journal) return;
    try { await this.journal.append(userId, row); }
    catch (error) { this.logger.warn('nutrition.cleanup.journal_failed', { userId, runId: row.runId ?? null, error: error.message }); }
  }
  #launch(userId, id) {
    if (this.#active.has(userId)) return;
    const promise = this.#execute(userId, id).catch(async error => {
      this.logger.warn('nutrition.cleanup.run_failed', { userId, runId: id, error: error.message });
      const failed = this.store.update(userId, state => {
        const run = state.runs[id];
        if (run.status === 'cancelled') return null;
        const transient = ![400, 404, 409].includes(error.status) && error.code !== 'AGENT_SCHEMA_INVALID';
        run.status = transient && run.attempt <= 2 ? 'retry' : 'failed';
        run.error = error.message;
        run.retryAt = this.clock.now() + 30000 * Math.pow(2, run.attempt);
        if (run.status !== 'failed') return null;
        state.checkedFingerprint = run.snapshot.fingerprint; state.checkedDigest = this.#digest(run.snapshot);
        pruneRuns(state);
        return { runId: id, at: run.createdAt || iso(this.clock.now()), status: 'failed', error: run.error, attempt: run.attempt,
          trigger: run.trigger ?? null, model: run.model ?? null };
      });
      if (failed) await this.#journal(userId, failed);
    }).finally(() => this.#active.delete(userId));
    this.#active.set(userId, promise);
  }
  /** The model and permissions a run was queued with; the current settings for a run from before they were recorded, or one that is gone. */
  #runPolicy(state, runId) {
    const run = state.runs[runId];
    const current = effectiveSettings(state.settings);
    return { model: run?.model || current.model, permissions: run?.permissions || current.permissions };
  }
  async #execute(userId, id) {
    let run = this.store.load(userId).runs[id];
    if (!run || terminal.has(run.status)) return;
    this.store.update(userId, state => { state.runs[id].status = 'running'; state.runs[id].attempt++; });
    const fence = () => this.store.load(userId).runs[id]?.status === 'running';
    if (!run.result) {
      // A run queued before model/permissions were recorded resumes with its original input.
      const input = { snapshot: run.snapshot, ...(run.model ? { model: run.model, permissions: run.permissions } : {}) };
      const result = await this.runs.start({ workflowId: 'nutrition-audit', userId, runId: id, input });
      if (result.status !== 'success') throw new Error(result.error?.message || 'Audit reasoning did not complete');
      if (!fence()) return;
      this.store.update(userId, state => { state.runs[id].result = result.result; });
    }
    const state = this.store.load(userId);
    run = state.runs[id];
    if (run?.status !== 'running') return;
    const result = run.result;
    const { permissions } = this.#runPolicy(state, id);
    const evidenceById = new Map(result.evidence.map(source => [source.id, source]));
    const outcomes = [];
    const questions = [...result.questions];
    for (const [index, proposal] of result.repairs.entries()) {
      const evidence = proposal.evidenceIds.map(key => evidenceById.get(key)).filter(Boolean);
      if (evidence.length !== proposal.evidenceIds.length) { outcomes.push({ status: 'rejected', reason: 'Unknown evidence' }); continue; }
      const blocked = blockedKinds(proposal, permissions);
      if (blocked.length) {
        outcomes.push({ status: 'blocked', kinds: blocked, proposal });
        this.logger.info('nutrition.cleanup.blocked', { userId, runId: id, kinds: blocked });
        continue;
      }
      try {
        const applied = await this.repairs.apply({ userId, operationId: id + '_' + index, runId: id, proposal, evidence, fence, dryRun: run.dryRun });
        outcomes.push(run.dryRun ? { status: 'proposed', proposal } : { status: applied.affectedIds?.length ? 'applied' : 'unchanged',
          operationId: id + '_' + index, affectedIds: applied.affectedIds || [] });
      } catch (error) {
        if (error.status !== 409 && error.status !== 404) throw error;
        outcomes.push({ status: 'skipped', reason: error.message, ...(run.dryRun ? { proposal } : {}) });
      }
    }
    // A choice the settings forbid is not offered; a question left without a
    // real choice is not asked. #answer checks the same permissions again.
    // Suppression is recorded the same way in dry run; only asking needs a live run.
    const suppressedQuestions = [];
    const suppress = (q, reason) => suppressedQuestions.push({ question: q.question, entryIds: q.entryIds, reason });
    const allRows = [...run.snapshot.rows, ...run.snapshot.pending.flatMap(log => log.items)];
    const askable = [];
    for (const original of questions) {
      if (permissions.questions === false) { suppress(original, 'questions-off'); continue; }
      const q = { ...original, choices: original.choices.filter(choice => !blockedKinds(choice.repair, permissions).length) };
      if (q.choices.length < 2) { suppress(original, 'blocked'); continue; }
      const entries = allRows.filter(row => q.entryIds.includes(row.uuid) || q.entryIds.includes(row.id));
      if (entries.length !== new Set(q.entryIds).size) { suppress(original, 'entries-missing'); continue; }
      askable.push({ q, entries });
    }
    if (!run.dryRun && fence()) for (const { q, entries } of askable) {
      this.interactions.ask(userId, {
        dedupeIssue: true,
        issueKey: sha256Text(JSON.stringify([q.entryIds.slice().sort(), [...new Set(q.choices.flatMap(choice => choice.repair.updates.flatMap(update => Object.keys(update.changes))))].sort()])),
        question: q.question, runId: id, entryVersions: entries.map(row => ({ id: entryKey(row), version: row.version ?? 1, date: row.date,
          ...(row.review ? { stabilizesAt: row.review.stabilizesAt } : {}) })),
        choices: q.choices.map((choice, i) => ({ ...choice, id: String(i) })), evidence: result.evidence,
        entryNames: Object.fromEntries(entries.flatMap(row => [row.id, row.uuid].filter(Boolean).map(key => [key, row.name || row.label || row.item || key]))),
        snapshot: run.snapshot,
      });
    }
    // run.model stays the plain name in every state; the runtime reports {provider,name}.
    const telemetry = { model: result.model?.name ?? run.model ?? null, usage: result.usage ?? null, costUsd: result.costUsd ?? null,
      turnId: result.turnId ?? null, toolCalls: result.toolCalls ?? [] };
    // What counts as checked: the audited input, or the state after this run
    // when the only rows that moved are the ones it repaired itself. Anything
    // else (a capture that landed mid-run) keeps the input, so it is audited next.
    let checked = { fingerprint: run.snapshot.fingerprint, digest: this.#digest(run.snapshot) };
    if (checked.digest) {
      try {
        this.auditor.refreshReferences?.();
        const post = await this.auditor.snapshot(userId);
        const postDigest = this.#digest(post);
        if (onlyOwnChanges(checked.digest, postDigest, new Set(outcomes.flatMap(o => o.affectedIds || [])))) checked = { fingerprint: post.fingerprint, digest: postDigest };
      } catch (error) {
        this.logger.warn('nutrition.cleanup.post_snapshot_failed', { userId, runId: id, error: error.message });
      }
    }
    const completed = this.store.update(userId, state => {
      if (state.runs[id].status !== 'running') return null;
      Object.assign(state.runs[id], { status: 'completed', outcomes, summary: result.summary, completedAt: new Date(this.clock.now()).toISOString(),
        ...telemetry, ...(suppressedQuestions.length ? { suppressedQuestions } : {}) });
      state.checkedFingerprint = checked.fingerprint; state.checkedDigest = checked.digest;
      // Full reasoning checkpoints live in the managed-run store; do not copy
      // every completed report back through this dispatch file on each poll.
      delete state.runs[id].snapshot; delete state.runs[id].result;
      const done = state.runs[id];
      pruneRuns(state);
      return done;
    });
    // One journal row per run, filed under its start time (the journal months and dedupes by it).
    if (completed) await this.#journal(userId, { runId: id, at: completed.createdAt || completed.completedAt, completedAt: completed.completedAt,
      status: 'completed', trigger: completed.trigger ?? null, ...telemetry, outcomes, suppressedQuestions,
      questions: askable.map(({ q }) => ({ question: q.question, choices: q.choices.map(choice => choice.label) })),
      summary: result.summary, dryRun: run.dryRun, manual: !!run.manual, overCap: !!run.overCap });
    // `changed` counts repairs that landed (or would have, in dry run); with the
    // triage verdict beside it, this line is the shadow-mode evaluation row.
    const changed = outcomes.filter(o => o.status === 'applied' || o.status === 'proposed').length;
    this.logger.info('nutrition.cleanup.completed', { userId, runId: id, dryRun: run.dryRun, repairs: outcomes.length, changed,
      questions: questions.length, ...(run.triage ? { triageNeedsAudit: run.triage.needsAudit, triageReason: run.triage.reason,
        triageScore: run.triage.score } : {}) });
  }
  async #answer(userId, question) {
    if (question.prepared) {
      notPermitted(question.prepared.proposal, this.#runPolicy(this.store.load(userId), question.runId).permissions);
      const result = await this.repairs.apply({ userId, operationId: 'answer_' + question.id, runId: question.runId,
        ...question.prepared, userDirected: true });
      return { status: 'resolved', result };
    }
    const dates = cleanupDates(this.clock.now(), this.timezoneFor(userId));
    if (questionExpired(question, this.clock.now(), dates)) fail('The review window has closed. You can still edit the entry manually.');
    const current = await this.auditor.snapshot(userId);
    const rows = [...current.rows, ...current.pending.flatMap(log => log.items)];
    for (const expected of question.entryVersions) {
      const row = rows.find(row => entryKey(row) === expected.id);
      if (!row || (row.version ?? 1) !== expected.version) fail('The food changed while this question was open.');
    }
    // The originating run's settings govern its question. Pruning keeps a run
    // an open question points at; older records fall back to the current settings.
    const { model, permissions } = this.#runPolicy(this.store.load(userId), question.runId);
    let proposal = question.choices.find(choice => choice.id === question.answer.choiceId)?.repair;
    let evidence = question.evidence;
    if (!proposal) {
      const result = await this.auditor.audit({ snapshot: current, answer: { question: question.question, text: question.answer.text },
        model, permissions }, { userId, runId: 'answer_' + question.id });
      if (result.questions.length || result.repairs.length !== 1) return { status: 'stale', message: 'The answer needs a manual edit to avoid guessing.' };
      proposal = result.repairs[0]; evidence = result.evidence;
    }
    notPermitted(proposal, permissions);
    const allowed = new Set(rows.filter(row => question.entryVersions.some(expected => expected.id === entryKey(row))).flatMap(row => [row.id, row.uuid]).filter(Boolean));
    const ids = [...proposal.updates.map(u => u.id), ...proposal.createGroups.flatMap(g => g.children.map(c => c.id))];
    if (ids.some(id => !allowed.has(id))) fail('Answer proposed unrelated changes');
    const prepared = { proposal, evidence: [...evidence, { id: question.id, kind: 'user', data: question.answer }] };
    this.store.update(userId, state => { state.questions[question.id].prepared = prepared; });
    return this.#answer(userId, { ...question, prepared });
  }
  async tick(userId) {
    await this.stabilization?.run(userId);
    if (this.store.load(userId).policyVersion !== 2) this.store.update(userId, state => {
      state.policyVersion = 2; state.settings.telegram = false;
    });
    await this.interactions.recover(userId);
    const state = this.store.load(userId);
    const dates = cleanupDates(this.clock.now(), this.timezoneFor(userId));
    if (Object.values(state.questions).some(q => q.status === 'open' && questionExpired(q, this.clock.now(), dates))) {
      this.store.update(userId, current => {
        for (const q of Object.values(current.questions)) if (q.status === 'open' && questionExpired(q, this.clock.now(), dates)) { q.status = 'stale'; q.version++; }
      });
    }
    if (!state.settings.enabled) return;
    const queued = Object.values(state.runs).find(r => !terminal.has(r.status));
    if (queued) { if (!queued.retryAt || queued.retryAt <= this.clock.now()) this.#launch(userId, queued.id); return; }
    // Automatic runs keep the minimum gap; a waiting sweep or change is kept, not lost.
    const settings = effectiveSettings(state.settings);
    const waiting = state.lastAutoRunAt && this.clock.now() - state.lastAutoRunAt < settings.minGapMinutes * 60000;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.timezoneFor(userId), hour: 'numeric', hourCycle: 'h23' }).format(new Date(this.clock.now())));
    if (!this.#started.has(userId) || (hour >= 3 && state.lastSweepDay !== dates[0])) {
      if (waiting) return;
      this.#started.add(userId);
      if (hour >= 3) this.store.update(userId, current => { current.lastSweepDay = dates[0]; });
      await this.request(userId, { reconcile: true }); return;
    }
    const snapshot = await this.auditor.snapshot(userId);
    if (snapshot.fingerprint === state.checkedFingerprint) { this.#dirty.delete(userId); return; }
    const digest = this.#digest(snapshot);
    const kinds = digest ? [...classifyChange(state.checkedDigest, digest)] : null;
    if (kinds && !kinds.length) {
      // Only bookkeeping moved (versions, timestamps) or a row left the window.
      this.store.update(userId, current => { current.checkedFingerprint = snapshot.fingerprint; current.checkedDigest = digest; });
      this.#dirty.delete(userId); return;
    }
    if (kinds && await this.#filtered(userId, snapshot, digest, kinds, settings)) { this.#dirty.delete(userId); return; }
    const now = this.clock.now();
    const dirty = this.#dirty.get(userId) || { first: now, changed: now, fingerprint: snapshot.fingerprint };
    if (dirty.fingerprint !== snapshot.fingerprint) { dirty.changed = now; dirty.fingerprint = snapshot.fingerprint; }
    this.#dirty.set(userId, dirty);
    if ((now - dirty.changed >= 60000 || now - dirty.first >= 120000) && !waiting) {
      this.#dirty.delete(userId); await this.request(userId, kinds ? { trigger: kinds } : {});
    }
  }
  async settled(userId) { await this.#active.get(userId); }
}
