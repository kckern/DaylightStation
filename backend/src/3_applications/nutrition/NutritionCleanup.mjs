import { sha256Text } from '#system/utils/sha256.mjs';
import { cleanupDates, entryKey } from '#domains/nutrition/services/cleanupPolicy.mjs';
import { AgentInteractions } from '#apps/agents/framework/AgentInteractions.mjs';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const terminal = new Set(['completed', 'failed', 'cancelled']);

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
    return { version: state.version, settings: state.settings,
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
    const allowed = ['enabled', 'dryRun', 'telegram'];
    if (Object.entries(changes).some(([key, value]) => !allowed.includes(key) || typeof value !== 'boolean')) fail('Invalid settings', 400);
    this.store.update(userId, state => {
      if (state.version !== expectedVersion) fail('Settings changed. Reload first.');
      Object.assign(state.settings, changes);
      if (changes.enabled === false) for (const run of Object.values(state.runs)) if (!terminal.has(run.status)) run.status = 'cancelled';
    });
    if (changes.enabled === false) {
      for (const run of Object.values(this.store.load(userId).runs).filter(r => r.status === 'cancelled')) {
        try { await this.runs.cancel({ workflowId: 'nutrition-audit', userId, runId: run.id }); } catch { /* an undispatched run has no SDK state */ }
      }
    }
    return this.status(userId);
  }
  async request(userId, { manual = false, reconcile = false } = {}) {
    const state = this.store.load(userId);
    if (!manual && !state.settings.enabled) return null;
    const existing = Object.values(state.runs).find(run => !terminal.has(run.status));
    if (existing) { this.#launch(userId, existing.id); return { runId: existing.id }; }
    this.auditor.refreshReferences?.();
    const snapshot = await this.auditor.snapshot(userId);
    if (!manual && !reconcile && state.checkedFingerprint === snapshot.fingerprint) return null;
    let id = 'audit_' + sha256Text(userId + snapshot.fingerprint + this.clock.now() + state.version).slice(0, 24);
    this.store.update(userId, current => {
      const queued = Object.values(current.runs).find(run => !terminal.has(run.status));
      if (queued) { id = queued.id; return; }
      if (!manual && !current.settings.enabled) { id = null; return; }
      current.runs[id] = { id, status: 'queued', attempt: 0, snapshot, dryRun: current.settings.dryRun,
        createdAt: new Date(this.clock.now()).toISOString(), manual };
    });
    if (!id) return null;
    this.#launch(userId, id);
    return { runId: id };
  }
  #launch(userId, id) {
    if (this.#active.has(userId)) return;
    const promise = this.#execute(userId, id).catch(error => {
      this.logger.warn('nutrition.cleanup.run_failed', { userId, runId: id, error: error.message });
      this.store.update(userId, state => {
        const run = state.runs[id];
        if (run.status === 'cancelled') return;
        const transient = ![400, 404, 409].includes(error.status) && error.code !== 'AGENT_SCHEMA_INVALID';
        run.status = transient && run.attempt <= 2 ? 'retry' : 'failed';
        run.error = error.message;
        if (run.status === 'failed') state.checkedFingerprint = run.snapshot.fingerprint;
        run.retryAt = this.clock.now() + 30000 * Math.pow(2, run.attempt);
      });
    }).finally(() => this.#active.delete(userId));
    this.#active.set(userId, promise);
  }
  async #execute(userId, id) {
    let run = this.store.load(userId).runs[id];
    if (!run || terminal.has(run.status)) return;
    this.store.update(userId, state => { state.runs[id].status = 'running'; state.runs[id].attempt++; });
    const fence = () => this.store.load(userId).runs[id]?.status === 'running';
    if (!run.result) {
      const result = await this.runs.start({ workflowId: 'nutrition-audit', userId, runId: id, input: { snapshot: run.snapshot } });
      if (result.status !== 'success') throw new Error(result.error?.message || 'Audit reasoning did not complete');
      if (!fence()) return;
      this.store.update(userId, state => { state.runs[id].result = result.result; });
    }
    run = this.store.load(userId).runs[id];
    if (!fence()) return;
    const result = run.result;
    const evidenceById = new Map(result.evidence.map(source => [source.id, source]));
    const outcomes = [];
    const questions = [...result.questions];
    for (const [index, proposal] of result.repairs.entries()) {
      const evidence = proposal.evidenceIds.map(key => evidenceById.get(key)).filter(Boolean);
      if (evidence.length !== proposal.evidenceIds.length) { outcomes.push({ status: 'rejected', reason: 'Unknown evidence' }); continue; }
      try {
        const applied = await this.repairs.apply({ userId, operationId: id + '_' + index, runId: id, proposal, evidence, fence, dryRun: run.dryRun });
        outcomes.push(run.dryRun ? { status: 'proposed', proposal } : { status: applied.affectedIds?.length ? 'applied' : 'unchanged', operationId: id + '_' + index });
      } catch (error) {
        if (error.status !== 409 && error.status !== 404) throw error;
        outcomes.push({ status: 'skipped', reason: error.message, ...(run.dryRun ? { proposal } : {}) });
        if (error.code === 'CLEANUP_REVIEW_REQUIRED') questions.push({ question: proposal.reason + '. Is this change correct?',
          entryIds: proposal.updates.map(u => u.id), choices: [{ label: 'Apply these changes', repair: proposal }] });
      }
    }
    if (!run.dryRun && fence()) for (const q of questions) {
      const allRows = [...run.snapshot.rows, ...run.snapshot.pending.flatMap(log => log.items)];
      const entries = allRows.filter(row => q.entryIds.includes(row.uuid) || q.entryIds.includes(row.id));
      if (entries.length !== new Set(q.entryIds).size) continue;
      this.interactions.ask(userId, {
        issueKey: sha256Text(JSON.stringify([q.entryIds.slice().sort(), [...new Set(q.choices.flatMap(choice => choice.repair.updates.flatMap(update => Object.keys(update.changes))))].sort()])),
        question: q.question, runId: id, entryVersions: entries.map(row => ({ id: entryKey(row), version: row.version ?? 1, date: row.date })),
        choices: q.choices.map((choice, i) => ({ ...choice, id: String(i) })), evidence: result.evidence,
        entryNames: Object.fromEntries(entries.flatMap(row => [row.id, row.uuid].filter(Boolean).map(key => [key, row.name || row.label || row.item || key]))),
        snapshot: run.snapshot,
      });
    }
    this.store.update(userId, state => {
      if (state.runs[id].status !== 'running') return;
      Object.assign(state.runs[id], { status: 'completed', outcomes, summary: result.summary, completedAt: new Date(this.clock.now()).toISOString() });
      // Do not suppress a concurrent capture. Own repairs are the only permitted
      // change between the audited input and this checked output.
      state.checkedFingerprint = run.snapshot.fingerprint;
      // Full reasoning checkpoints live in the managed-run store; do not copy
      // every completed report back through this dispatch file on each poll.
      delete state.runs[id].snapshot; delete state.runs[id].result;
    });
    this.logger.info('nutrition.cleanup.completed', { userId, runId: id, dryRun: run.dryRun, repairs: outcomes.length, questions: questions.length });
  }
  async #answer(userId, question) {
    if (question.prepared) {
      const result = await this.repairs.apply({ userId, operationId: 'answer_' + question.id, runId: question.runId,
        ...question.prepared, userDirected: true });
      return { status: 'resolved', result };
    }
    const dates = cleanupDates(this.clock.now(), this.timezoneFor(userId));
    if (question.entryVersions.some(row => !dates.includes(row.date))) fail('This question is outside today/yesterday. Edit the historical entry manually.');
    const current = await this.auditor.snapshot(userId);
    const rows = [...current.rows, ...current.pending.flatMap(log => log.items)];
    for (const expected of question.entryVersions) {
      const row = rows.find(row => entryKey(row) === expected.id);
      if (!row || (row.version ?? 1) !== expected.version) fail('The food changed while this question was open.');
    }
    let proposal = question.choices.find(choice => choice.id === question.answer.choiceId)?.repair;
    let evidence = question.evidence;
    if (!proposal) {
      const result = await this.auditor.audit({ snapshot: current, answer: { question: question.question, text: question.answer.text } },
        { userId, runId: 'answer_' + question.id });
      if (result.questions.length || result.repairs.length !== 1) return { status: 'stale', message: 'The answer needs a manual edit to avoid guessing.' };
      proposal = result.repairs[0]; evidence = result.evidence;
    }
    const allowed = new Set(rows.filter(row => question.entryVersions.some(expected => expected.id === entryKey(row))).flatMap(row => [row.id, row.uuid]).filter(Boolean));
    const ids = [...proposal.updates.map(u => u.id), ...proposal.createGroups.flatMap(g => g.children.map(c => c.id))];
    if (ids.some(id => !allowed.has(id))) fail('Answer proposed unrelated changes');
    const prepared = { proposal, evidence: [...evidence, { id: question.id, kind: 'user', data: question.answer }] };
    this.store.update(userId, state => { state.questions[question.id].prepared = prepared; });
    return this.#answer(userId, { ...question, prepared });
  }
  async tick(userId) {
    await this.interactions.recover(userId);
    const state = this.store.load(userId);
    const dates = cleanupDates(this.clock.now(), this.timezoneFor(userId));
    if (Object.values(state.questions).some(q => q.status === 'open' && q.entryVersions.some(row => !dates.includes(row.date)))) {
      this.store.update(userId, current => {
        for (const q of Object.values(current.questions)) if (q.status === 'open' && q.entryVersions.some(row => !dates.includes(row.date))) { q.status = 'stale'; q.version++; }
      });
    }
    if (!state.settings.enabled) return;
    const queued = Object.values(state.runs).find(r => !terminal.has(r.status));
    if (queued) { if (!queued.retryAt || queued.retryAt <= this.clock.now()) this.#launch(userId, queued.id); return; }
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.timezoneFor(userId), hour: 'numeric', hourCycle: 'h23' }).format(new Date(this.clock.now())));
    if (!this.#started.has(userId) || (hour >= 3 && state.lastSweepDay !== dates[0])) {
      this.#started.add(userId);
      if (hour >= 3) this.store.update(userId, current => { current.lastSweepDay = dates[0]; });
      await this.request(userId, { reconcile: true }); return;
    }
    const snapshot = await this.auditor.snapshot(userId);
    if (snapshot.fingerprint === state.checkedFingerprint) { this.#dirty.delete(userId); return; }
    const now = this.clock.now();
    const dirty = this.#dirty.get(userId) || { first: now, changed: now, fingerprint: snapshot.fingerprint };
    if (dirty.fingerprint !== snapshot.fingerprint) { dirty.changed = now; dirty.fingerprint = snapshot.fingerprint; }
    this.#dirty.set(userId, dirty);
    if (now - dirty.changed >= 60000 || now - dirty.first >= 120000) { this.#dirty.delete(userId); await this.request(userId); }
  }
  async settled(userId) { await this.#active.get(userId); }
}
