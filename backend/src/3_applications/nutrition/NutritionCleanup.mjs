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
const round = usd => Math.round(usd * 1e6) / 1e6;
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const changedOutcome = outcome => outcome?.status === 'applied' || outcome?.status === 'proposed';
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

const tokenCount = value => (Number.isFinite(value) ? value : null);
/**
 * Token usage in the journal's one shape, { input, cached, output } (numbers or
 * null). Accepts that shape (backfilled rows and live rows from now on) and the
 * runtime's raw { inputTokens, cachedInputTokens, outputTokens, raw } that live
 * rows stored before; provider detail (`raw`) is dropped. Null without usage.
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return { input: tokenCount(usage.input ?? usage.inputTokens), cached: tokenCount(usage.cached ?? usage.cachedInputTokens),
    output: tokenCount(usage.output ?? usage.outputTokens) };
}
const usageOf = row => normalizeUsage(row?.usage);
const withUsage = row => (row.runId ? { ...row, usage: usageOf(row) } : row);

// The fields a person reads in "what it changed" (the same list the Health repair view shows).
const CHANGE_FIELDS = ['name', 'label', 'kind', 'parentId', 'icon', 'photoRef', 'foodId', 'date', 'mealTime', 'amount', 'unit', 'grams',
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
// A created row (a new group header) is described by what it is, not by its zeroed nutrients.
const CREATED_FIELDS = ['name', 'kind', 'date', 'mealTime'];
const CHANGE_LIMIT = 50;
const sameRow = (a, b) => (a.uuid && a.uuid === b.uuid) || (a.id && (a.id === b.id || a.id === b.uuid)) || (b.id && b.id === a.uuid);
/**
 * Field-level before/after for the rows a repair touched: `[{ id, name, field,
 * from, to }]`, at most 50, with `changesOmitted` when more. A label that moved
 * with the name is not listed twice.
 */
export function changeDigest(beforeRows, afterRows) {
  const changes = [];
  for (const after of afterRows || []) {
    const before = (beforeRows || []).find(row => sameRow(row, after));
    const name = after.name || after.label || before?.name || before?.label || entryKey(after);
    const fields = before ? CHANGE_FIELDS : CREATED_FIELDS;
    const rowChanges = fields.map(field => ({ field, from: before?.[field] ?? null, to: after[field] ?? null }))
      .filter(({ from, to }) => JSON.stringify(from) !== JSON.stringify(to));
    const renamed = rowChanges.some(change => change.field === 'name');
    for (const change of rowChanges) if (!(renamed && change.field === 'label')) changes.push({ id: entryKey(after), name, ...change });
  }
  return changes.length > CHANGE_LIMIT ? { changes: changes.slice(0, CHANGE_LIMIT), changesOmitted: changes.length - CHANGE_LIMIT } : { changes };
}
/** The rows a dry-run proposal would produce, from the audited snapshot: its updates, and any new group with its children. */
function proposedRows(snapshotRows, proposal) {
  const find = id => snapshotRows.find(row => row.uuid === id || row.id === id);
  const after = new Map();
  const edit = (id, changes) => {
    const row = after.get(id) || find(id);
    if (row) after.set(id, { ...row, ...changes });
  };
  for (const update of proposal.updates || []) {
    const changes = { ...update.changes };
    if (changes.label !== undefined) changes.name = changes.label;
    edit(update.id, changes);
  }
  for (const group of proposal.createGroups || []) {
    // The header has no id until it is written; the digest names it by its label.
    const headerId = 'new-group:' + group.label;
    const first = find(group.children?.[0]?.id);
    after.set(headerId, { uuid: headerId, name: group.label, kind: 'group', date: first?.date ?? null, mealTime: first?.mealTime ?? null });
    for (const child of group.children || []) edit(child.id, { parentId: headerId });
  }
  return [...after.values()];
}

const RESULT_MAX_CHARS = 8192;
const RESULT_PREVIEW_CHARS = 2048;
/** A tool result small enough to send: long text is cut with a marker, a large object becomes a preview. */
function capResult(result) {
  if (typeof result === 'string') {
    return result.length > RESULT_MAX_CHARS ? `${result.slice(0, RESULT_MAX_CHARS)}…[truncated ${result.length - RESULT_MAX_CHARS} chars]` : result;
  }
  if (result === null || typeof result !== 'object') return result;
  const json = JSON.stringify(result);
  return json.length > RESULT_MAX_CHARS ? { truncated: true, chars: json.length, preview: json.slice(0, RESULT_PREVIEW_CHARS) } : result;
}
/** What run detail shows of an agent transcript: tool calls (results capped), how many rows went in, prompt size. */
function transcriptView(transcript) {
  let inputRows = null;
  try {
    const snapshot = JSON.parse(transcript.input?.text || 'null')?.snapshot;
    if (snapshot) inputRows = (snapshot.rows || []).length + (snapshot.pending || []).reduce((sum, log) => sum + (log.items || []).length, 0);
  } catch { /* an unparseable input has no row count */ }
  return {
    toolCalls: (transcript.toolCalls || []).map(({ name, args, result, ok, latencyMs }) => ({ name, args, result: capResult(result), ok, latencyMs })),
    inputRows, systemPromptChars: typeof transcript.systemPrompt === 'string' ? transcript.systemPrompt.length : 0,
  };
}

/** Durable dispatcher and application phase gates around read-only AI reasoning. */
export class NutritionCleanup {
  #active = new Map(); #dirty = new Map(); #started = new Set(); #sweepBackoff = new Map();
  constructor(deps) {
    // `journal` is a method here; the run journal store is `journalStore`.
    if ('journal' in deps) throw new Error('NutritionCleanup takes journalStore, not journal');
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
  /** The household date of an instant (ISO string), or null when unparseable. */
  #householdDate(userId, at) {
    const t = Date.parse(at);
    return Number.isFinite(t) ? cleanupDates(t, this.timezoneFor(userId))[0] : null;
  }
  /** Journal rows whose household date of `at` is in [from, to], newest first. */
  async #journalRows(userId, from, to) {
    if (!this.journalStore) return [];
    const rows = await this.journalStore.list(userId, { from: iso(Date.parse(from + 'T00:00:00Z') - DAY_MS), to: iso(Date.parse(to + 'T00:00:00Z') + 2 * DAY_MS) });
    return rows.filter(row => { const date = this.#householdDate(userId, row.at); return date && date >= from && date <= to; });
  }
  /**
   * Run journal page. Dates are household days; the default is the last seven.
   * `trigger` keeps runs whose trigger includes it; `changed` keeps runs where a
   * repair was applied or proposed (skip rows have no outcomes, so it drops them).
   */
  async journal(userId, { from, to, trigger, changed = false, offset = 0, limit = 50 } = {}) {
    const today = cleanupDates(this.clock.now(), this.timezoneFor(userId))[0];
    to ??= today; from ??= addDays(to, -6);
    const rows = (await this.#journalRows(userId, from, to))
      .filter(row => !trigger || (Array.isArray(row.trigger) && row.trigger.includes(trigger)))
      .filter(row => !changed || (row.outcomes || []).some(changedOutcome));
    return { rows: rows.slice(offset, offset + limit).map(withUsage), total: rows.length };
  }
  /**
   * One run's journal row, with a view of its agent transcript while that is
   * still kept. Null for an unknown run. `at` (the run's start) narrows the
   * read; a hint that misses falls back to the newest-first search.
   */
  async journalEntry(userId, runId, { at } = {}) {
    if (!this.journalStore) return null;
    const row = (at ? await this.journalStore.findRun(userId, runId, { around: at }) : null) ?? await this.journalStore.findRun(userId, runId);
    if (!row) return null;
    let raw = null, transcriptError = false;
    if (row.turnId && this.transcripts) {
      try { raw = await this.transcripts.find({ userId, startedAt: row.at, turnId: row.turnId }); }
      catch (error) {
        transcriptError = true;
        this.logger.warn('nutrition.cleanup.transcript_read_failed', { userId, runId, error: error.message });
      }
    }
    const outcomes = Array.isArray(row.outcomes) ? await Promise.all(row.outcomes.map(outcome => this.#withUndo(userId, outcome))) : row.outcomes;
    return { ...withUsage(row), ...(outcomes ? { outcomes } : {}), transcript: raw ? transcriptView(raw) : null,
      transcriptExpired: !!(row.turnId && this.transcripts && !raw && !transcriptError), ...(transcriptError ? { transcriptError } : {}) };
  }
  /**
   * An applied outcome gains `undoneAt` once a person undid it. Undo receipts are
   * `undo_<operationId>`: in the nutrition ledger for committed rows, in the
   * capture's metadata for a pending capture. A failed lookup leaves it unmarked.
   */
  async #withUndo(userId, outcome) {
    if (outcome?.status !== 'applied' || !outcome.operationId) return outcome;
    const undoId = 'undo_' + outcome.operationId;
    try {
      const receipt = outcome.logUuid
        ? (await this.foodLogs.findById(userId, outcome.logUuid))?.metadata?.cleanupAudit?.[undoId]
        : await this.items.getCleanupAudit(userId, undoId);
      return receipt?.at ? { ...outcome, undoneAt: receipt.at } : outcome;
    } catch (error) {
      this.logger.warn('nutrition.cleanup.undo_lookup_failed', { userId, operationId: outcome.operationId, error: error.message });
      return outcome;
    }
  }
  /**
   * Auditor spend by household day. Totals come from the journal (completed
   * runs); a turn billed before its run failed is only in the AI usage ledger,
   * which the cap enforces on, so `ledgerTodayUsd` gives that enforced figure.
   * `changed` counts repairs applied or proposed; averages are over priced runs.
   */
  async spend(userId, { days = 30 } = {}) {
    const today = cleanupDates(this.clock.now(), this.timezoneFor(userId))[0];
    const first = addDays(today, 1 - days);
    const monthStart = today.slice(0, 8) + '01';
    const weekStart = addDays(today, -6);
    // Read back far enough for the day range, the calendar month and the week, whichever starts first.
    const rows = (await this.#journalRows(userId, [first, monthStart, weekStart].sort()[0], today)).filter(row => row.runId);
    const byDate = new Map(Array.from({ length: days }, (_, i) => addDays(first, i)).map(date => [date, { date, costUsd: 0, runs: 0, changed: 0 }]));
    const triggers = new Map(), models = new Map();
    const tally = (map, key, row) => {
      const entry = map.get(key) || { runs: 0, priced: 0, costUsd: 0, tokens: { input: 0, cached: 0, output: 0 } };
      entry.runs++; if (Number.isFinite(row.costUsd)) { entry.priced++; entry.costUsd += row.costUsd; }
      const usage = usageOf(row);
      if (usage) for (const kind of ['input', 'cached', 'output']) entry.tokens[kind] += usage[kind] ?? 0;
      map.set(key, entry);
    };
    let week = 0, month = 0, todayUsd = 0;
    for (const row of rows) {
      const date = this.#householdDate(userId, row.at);
      const cost = Number.isFinite(row.costUsd) ? row.costUsd : 0;
      if (date >= monthStart) month += cost;
      if (date >= weekStart) week += cost;
      if (date === today) todayUsd += cost;
      const day = byDate.get(date);
      if (!day) continue;
      day.costUsd += cost; day.runs++; day.changed += (row.outcomes || []).filter(changedOutcome).length;
      for (const kind of new Set(row.trigger || [])) tally(triggers, kind, row);
      tally(models, row.model || 'unknown', row);
    }
    const avg = entry => (entry.priced ? round(entry.costUsd / entry.priced) : 0);
    const byCost = (a, b) => b[1].costUsd - a[1].costUsd;
    const state = this.store.load(userId);
    const settings = effectiveSettings(state.settings);
    let ledgerTodayUsd = null;
    if (this.spendSource) {
      try {
        const now = this.clock.now();
        const ledger = await this.spendSource({ from: iso(now - 2 * DAY_MS), to: iso(now + DAY_MS) });
        ledgerTodayUsd = round((ledger || []).reduce((sum, row) => sum + (this.#householdDate(userId, row?.ts) === today && Number.isFinite(row.costUsd) ? row.costUsd : 0), 0));
      } catch (error) { this.logger.warn('nutrition.cleanup.spend_read_failed', { userId, error: error.message }); }
    }
    return {
      days: [...byDate.values()].map(day => ({ ...day, costUsd: round(day.costUsd) })),
      today: round(todayUsd), week: round(week), month: round(month),
      byTrigger: [...triggers].sort(byCost).map(([trigger, entry]) => ({ trigger, runs: entry.runs, costUsd: round(entry.costUsd), avgUsd: avg(entry) })),
      byModel: [...models].sort(byCost).map(([model, entry]) => ({ model, runs: entry.runs, avgUsd: avg(entry), tokens: entry.tokens })),
      capUsd: settings.dailyCapUsd, cappedToday: this.#cappedToday(userId, state, settings), ledgerTodayUsd,
    };
  }
  /** Who changed which auditor setting, newest first. */
  settingsLog(userId) { return [...(this.store.load(userId).settingsLog || [])].reverse(); }
  /**
   * Queue (or resume) an audit. The run's trigger names why: ['manual'], or the
   * change kinds since the last check (plus 'dailySweep' for a sweep).
   * Automatic requests pass the trigger filter and the daily spend cap first;
   * manual ones only note being over cap.
   */
  async request(userId, { manual = false, reconcile = false } = {}) {
    const outcome = await this.#request(userId, { manual, reconcile });
    return outcome?.runId ? { runId: outcome.runId } : null;
  }
  /**
   * request() that also says why nothing was queued: { runId } | { skipped } | null.
   * `trigger` is tick's classification; it is joined with what this fresh
   * snapshot shows, since more may have changed while the change debounced.
   */
  async #request(userId, { manual = false, reconcile = false, trigger } = {}) {
    const state = this.store.load(userId);
    if (!manual && !state.settings.enabled) return null;
    const existing = Object.values(state.runs).find(run => !terminal.has(run.status));
    if (existing) { this.#launch(userId, existing.id); return { runId: existing.id }; }
    const settings = effectiveSettings(state.settings);
    if (!manual && this.#cappedToday(userId, state, settings)) return { skipped: 'cap' };
    this.auditor.refreshReferences?.();
    const snapshot = await this.auditor.snapshot(userId);
    if (!manual && !reconcile && state.checkedFingerprint === snapshot.fingerprint) return null;
    const digest = this.#digest(snapshot);
    const kinds = manual ? ['manual'] : this.#kinds(state, digest, { reconcile, trigger });
    if (!manual && await this.#filtered(userId, snapshot, digest, kinds, settings)) return { skipped: 'filtered' };
    const spend = manual && this.#cappedToday(userId, state, settings) ? { over: true } : await this.#spend(userId, settings);
    if (!manual && spend.over) { await this.#capped(userId, spend, settings); return { skipped: 'cap' }; }
    // Triage (NutritionAuditTriage): shadow records a verdict beside the run;
    // gate lets a clean verdict skip the LLM audit. Manual and daily
    // reconcile runs are never gated.
    const triage = !manual && this.triage?.active ? await this.triage.assess(snapshot) : null;
    if (triage && !triage.needsAudit && !reconcile && this.triage.gating) {
      this.store.update(userId, current => { current.checkedFingerprint = snapshot.fingerprint; current.checkedDigest = digest; });
      this.logger.info('nutrition.cleanup.skipped', { userId, fingerprint: snapshot.fingerprint, reason: triage.reason, score: triage.score });
      return { skipped: 'triage' };
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
  /**
   * What changed since the last check. Without a digest to compare (no hash, or
   * the first check after deploy) the answer is 'unclassified', which no setting
   * can switch off. A sweep adds 'dailySweep' to the real kinds, so switching the
   * sweep off never absorbs a change that happened to be pending at sweep time.
   */
  #kinds(state, digest, { reconcile = false, trigger = [] } = {}) {
    const fresh = digest && state.checkedDigest ? [...classifyChange(state.checkedDigest, digest)] : ['unclassified'];
    return [...new Set([...trigger, ...fresh, ...(reconcile ? ['dailySweep'] : [])])];
  }
  /** Over today's cap at this cap value: nothing automatic runs, and spend is not re-read, until the day or the cap changes. */
  #cappedToday(userId, state, settings) {
    return state.capped?.day === cleanupDates(this.clock.now(), this.timezoneFor(userId))[0] && state.capped.capUsd === settings.dailyCapUsd;
  }
  /** Record being over the cap. Called only when not already capped for this (day, cap), so each is journaled and logged once. */
  async #capped(userId, spend, settings) {
    const day = cleanupDates(this.clock.now(), this.timezoneFor(userId))[0];
    this.store.update(userId, state => { state.capped = { day, capUsd: settings.dailyCapUsd, spentUsd: spend.spentUsd }; });
    await this.#journal(userId, { at: iso(this.clock.now()), skipped: 'cap', spentUsd: spend.spentUsd, capUsd: settings.dailyCapUsd });
    this.logger.info('nutrition.cleanup.capped', { userId, spentUsd: spend.spentUsd, capUsd: settings.dailyCapUsd });
  }
  /** Every kind that changed is switched off: count the snapshot as checked, note it once, run nothing. */
  async #filtered(userId, snapshot, digest, kinds, settings) {
    if (!kinds.length || kinds.some(kind => settings.triggers[kind] !== false)) return false;
    const noted = this.store.load(userId).lastFilteredFingerprint === snapshot.fingerprint;
    this.store.update(userId, state => {
      state.checkedFingerprint = snapshot.fingerprint; state.checkedDigest = digest; state.lastFilteredFingerprint = snapshot.fingerprint;
    });
    if (!noted) {
      await this.#journal(userId, { at: iso(this.clock.now()), skipped: 'filtered', kinds });
      this.logger.info('nutrition.cleanup.filtered', { userId, kinds });
    }
    return true;
  }
  /**
   * Today's (household day) auditor spend against the cap. `spendSource` is the
   * AI usage ledger, which prices every billed turn including failed ones; the
   * journal (completed runs only) is the fallback. No source, no cap, or an
   * unreadable source: never over. Never throws.
   */
  async #spend(userId, settings) {
    const none = { over: false, spentUsd: null };
    if (settings.dailyCapUsd == null || (!this.spendSource && !this.journalStore)) return none;
    try {
      const now = this.clock.now(), tz = this.timezoneFor(userId);
      const today = cleanupDates(now, tz)[0];
      // Wider than any household day; rows are then kept by their household date.
      const range = { from: iso(now - 2 * DAY_MS), to: iso(now + DAY_MS) };
      const rows = this.spendSource ? await this.spendSource(range)
        : (await this.journalStore.list(userId, range)).map(row => ({ ts: row.at, costUsd: row.costUsd }));
      let spent = 0;
      for (const row of rows || []) {
        const t = Date.parse(row?.ts);
        if (Number.isFinite(t) && Number.isFinite(row.costUsd) && cleanupDates(t, tz)[0] === today) spent += row.costUsd;
      }
      const spentUsd = Math.round(spent * 1e6) / 1e6;
      return { over: spentUsd >= settings.dailyCapUsd, spentUsd };
    } catch (error) {
      this.logger.warn('nutrition.cleanup.spend_read_failed', { userId, error: error.message });
      return none;
    }
  }
  /** The journal is a record, not a gate: a failed write is logged and the run carries on. */
  async #journal(userId, row) {
    if (!this.journalStore) return;
    try { await this.journalStore.append(userId, row); }
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
    const snapshotRows = [...run.snapshot.rows, ...run.snapshot.pending.flatMap(log => log.items)];
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
        // Before is the audited snapshot (versions were checked on write); after is what was written, or would be.
        const described = { reason: proposal.reason, mode: proposal.mode || 'verified' };
        if (run.dryRun) outcomes.push({ status: 'proposed', proposal, ...described, ...changeDigest(snapshotRows, proposedRows(snapshotRows, proposal)) });
        else if (applied.affectedIds?.length) outcomes.push({ status: 'applied', operationId: id + '_' + index, affectedIds: applied.affectedIds,
          ...(applied.logUuid ? { logUuid: applied.logUuid } : {}), ...described, ...changeDigest(snapshotRows, applied.items) });
        else outcomes.push({ status: 'unchanged', operationId: id + '_' + index, affectedIds: [] });
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
    const askable = [];
    for (const original of questions) {
      if (permissions.questions === false) { suppress(original, 'questions-off'); continue; }
      const q = { ...original, choices: original.choices.filter(choice => !blockedKinds(choice.repair, permissions).length) };
      if (q.choices.length < 2) { suppress(original, 'blocked'); continue; }
      const entries = snapshotRows.filter(row => q.entryIds.includes(row.uuid) || q.entryIds.includes(row.id));
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
    const telemetry = { model: result.model?.name ?? run.model ?? null, usage: normalizeUsage(result.usage), costUsd: result.costUsd ?? null,
      turnId: result.turnId ?? null, toolCalls: result.toolCalls ?? [] };
    // What counts as checked: the audited input, or the state after this run
    // when the only rows that moved are the ones it repaired itself. Anything
    // else (a capture that landed mid-run) keeps the input, so it is audited next.
    let checked = { fingerprint: run.snapshot.fingerprint, digest: this.#digest(run.snapshot) };
    // Narrow window: a person's edit to one of this run's own rows (or its new
    // group's children) between the repair commit and this snapshot is absorbed
    // with the repair. Edits to any other row, captures and observations are not.
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
    // Gates, in order:
    //  1. A due sweep (startup, or local 03:00) runs when automatic runs may run
    //     (gap and cap), and is only marked done once it ran or was filtered.
    //  2. A change of bookkeeping only, or of switched-off kinds, is absorbed at
    //     once (marked checked), before the gap, so it never sits dirty.
    //  3. A real change debounces (60 s quiet, 120 s max), then waits for the gap
    //     and cap, and stays dirty until it may run.
    const settings = effectiveSettings(state.settings);
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.timezoneFor(userId), hour: 'numeric', hourCycle: 'h23' }).format(new Date(this.clock.now())));
    if (this.#sweepDue(userId, state, hour, dates)) return this.#sweep(userId, state, settings, hour, dates);
    const snapshot = await this.auditor.snapshot(userId);
    if (snapshot.fingerprint === state.checkedFingerprint) { this.#dirty.delete(userId); return; }
    const kinds = await this.#absorbIfNothingToAudit(userId, state, snapshot, settings);
    if (!kinds) { this.#dirty.delete(userId); return; }
    const now = this.clock.now();
    const dirty = this.#dirty.get(userId) || { first: now, changed: now, fingerprint: snapshot.fingerprint };
    if (dirty.fingerprint !== snapshot.fingerprint) { dirty.changed = now; dirty.fingerprint = snapshot.fingerprint; }
    this.#dirty.set(userId, dirty);
    if ((now - dirty.changed >= 60000 || now - dirty.first >= 120000) && this.#mayRunAutomatically(userId, state, settings)) {
      this.#dirty.delete(userId); await this.#request(userId, { trigger: kinds });
    }
  }
  #sweepDue(userId, state, hour, dates) {
    return !this.#started.has(userId) || (hour >= 3 && state.lastSweepDay !== dates[0]);
  }
  async #sweep(userId, state, settings, hour, dates) {
    if ((this.#sweepBackoff.get(userId) || 0) > this.clock.now() || !this.#mayRunAutomatically(userId, state, settings)) return;
    let outcome;
    try { outcome = await this.#request(userId, { reconcile: true }); }
    catch (error) {
      // A sweep that cannot even read its snapshot is retried in ten minutes, not on every tick.
      this.#sweepBackoff.set(userId, this.clock.now() + 10 * 60000);
      this.logger.warn('nutrition.cleanup.sweep_failed', { userId, error: error.message });
      return;
    }
    this.#sweepBackoff.delete(userId);
    // Only a sweep that ran or was filtered is done; a capped one stays due.
    if (outcome?.runId || outcome?.skipped === 'filtered') {
      this.#started.add(userId);
      if (hour >= 3) this.store.update(userId, current => { current.lastSweepDay = dates[0]; });
    }
  }
  /**
   * Marks the snapshot checked when there is nothing to audit and returns null;
   * otherwise returns the change kinds. Nothing to audit means only bookkeeping
   * moved (versions, timestamps), or rows were removed: a removed row (a person
   * deleting an entry, or a row leaving the review window; the digest cannot tell
   * them apart) starts no audit, and the rows that remain are unchanged. Also
   * nothing to audit: every kind that changed is switched off.
   */
  async #absorbIfNothingToAudit(userId, state, snapshot, settings) {
    const digest = this.#digest(snapshot);
    const kinds = this.#kinds(state, digest);
    if (digest && !kinds.length) {
      this.store.update(userId, current => { current.checkedFingerprint = snapshot.fingerprint; current.checkedDigest = digest; });
      return null;
    }
    return await this.#filtered(userId, snapshot, digest, kinds, settings) ? null : kinds;
  }
  /** Automatic runs keep the minimum gap and stop while capped for today at this cap. */
  #mayRunAutomatically(userId, state, settings) {
    const waiting = state.lastAutoRunAt && this.clock.now() - state.lastAutoRunAt < settings.minGapMinutes * 60000;
    return !waiting && !this.#cappedToday(userId, state, settings);
  }
  async settled(userId) { await this.#active.get(userId); }
}
