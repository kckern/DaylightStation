#!/usr/bin/env node

/**
 * Nutrition auditor journal backfill — rebuilds run-journal rows for runs that
 * finished before the journal existed, from two sources:
 *
 * 1. The cleanup state file (YamlAgentStateStore,
 *    <dataDir>/users/<userId>/agents/nutrition-cleanup.yml). Its `runs` hold what
 *    the auditor recorded: outcomes, summary, status, error, dry run, manual,
 *    timestamps. The state keeps only the newest 50 finished runs once the
 *    pruning build is deployed, so backfill before (or right after) deploying.
 * 2. The agent transcripts, one per billed turn, at
 *    <mediaDir>/logs/agents/nutrition-auditor/<YYYY-MM-DD>/<userId>/<HHMMSS-mmm>-<turnId8>.json
 *    A run that retried left several under one `input.context.runId`, so usage
 *    and cost are summed across them. Model, tool calls and questions come from
 *    the transcripts.
 *
 * For a runId in both, the state's recorded values win (outcomes, summary,
 * trigger, dryRun, manual, createdAt as `at`, completedAt, status, error) and
 * the transcripts supply usage, cost, tool calls and model. A state run with no
 * transcript still gets a row, with usage and cost null. A transcript with no
 * state run keeps its repairs as `proposals` (outcomes were not recorded).
 * Runs recorded before trigger tracking carry `trigger: ['unknown']`; turns that
 * interpreted a free-text answer (runId `answer_<questionId>`) carry ['answer'].
 *
 * Rows go through JsonlAuditJournalStore with source `backfill`, i.e. to
 *   <dataDir>/users/<userId>/lifelog/nutrition/auditor-journal/YYYY-MM.backfill.jsonl
 * so this never appends to a live writer's file. Runs already in the journal
 * (any writer) are skipped, so running it twice writes nothing the second time.
 *
 * Usage:
 *   node cli/nutrition-auditor-backfill.cli.mjs [options]
 *
 * Options:
 *   --since YYYY-MM-DD     First transcript day, UTC (default: 2026-09-06)
 *   --user <id>            One user (default: every user dir in the transcript tree)
 *   --media-dir <path>     Media root (default: $DAYLIGHT_BASE_PATH/media)
 *   --data-dir <path>      Data root (default: $DAYLIGHT_BASE_PATH/data)
 *   --state-file <path>    Cleanup state file for --user (required with it; default:
 *                          <dataDir>/users/<userId>/agents/nutrition-cleanup.yml)
 *   --dry-run              Print the rows that would be written; write nothing
 *
 * DAYLIGHT_BASE_PATH is read from the environment, else from the repo .env.
 * The default media dir matches ConfigService.getMediaDir() when system.yml sets
 * no `paths.media` (<baseDir>/media, baseDir = parent of the data dir).
 *
 * Examples:
 *   node cli/nutrition-auditor-backfill.cli.mjs --dry-run
 *   node cli/nutrition-auditor-backfill.cli.mjs --user kckern --since 2026-09-10
 *
 * @module cli/nutrition-auditor-backfill
 */

import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estimateCostUsd } from '#adapters/ai/aiPricing.mjs';
import { JsonlAuditJournalStore } from '#adapters/persistence/yaml/JsonlAuditJournalStore.mjs';
import { YamlAgentStateStore } from '#adapters/persistence/yaml/YamlAgentStateStore.mjs';
import yaml from 'js-yaml';

const AGENT_ID = 'nutrition-auditor';
const DEFAULT_SINCE = '2026-09-06';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const USER_RE = /^[a-zA-Z0-9_-]+$/;

// ============================================================================
// Pure helpers (exported for tests)
// ============================================================================

export function parseArgs(argv) {
  const flags = { 'dry-run': false, since: DEFAULT_SINCE };
  const withValue = new Set(['since', 'user', 'media-dir', 'data-dir', 'state-file']);
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) throw new Error(`Unexpected argument: ${tok}`);
    const key = tok.slice(2);
    if (withValue.has(key)) {
      const value = argv[++i];
      if (value == null || value.startsWith('--')) throw new Error(`--${key} needs a value`);
      flags[key] = value;
    } else if (key === 'dry-run' || key === 'help') {
      flags[key] = true;
    } else {
      throw new Error(`Unknown option: ${tok}`);
    }
  }
  if (!DAY_RE.test(flags.since)) throw new Error(`Bad --since: ${flags.since} (want YYYY-MM-DD)`);
  if (flags.user && !USER_RE.test(flags.user)) throw new Error(`Bad --user: ${flags.user}`);
  if (flags['state-file'] && !flags.user) throw new Error('--state-file needs --user (a state file belongs to one user)');
  return flags;
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Transcripts under `<mediaDir>/logs/agents/nutrition-auditor`, per user, for
 * days >= since. Unreadable files are counted, not thrown.
 * @returns {{ byUser: Map<string, object[]>, unreadable: string[] }}
 */
export function readTranscripts(mediaDir, { since = DEFAULT_SINCE, user = null } = {}) {
  const root = path.join(mediaDir, 'logs', 'agents', AGENT_ID);
  const byUser = new Map();
  const unreadable = [];
  for (const day of listDirs(root).filter(d => DAY_RE.test(d) && d >= since).sort()) {
    for (const userId of listDirs(path.join(root, day)).sort()) {
      if (user ? userId !== user : !USER_RE.test(userId) || userId === 'anonymous') continue;
      const dir = path.join(root, day, userId);
      for (const name of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
        const file = path.join(dir, name);
        try {
          const transcript = JSON.parse(readFileSync(file, 'utf8'));
          if (!byUser.has(userId)) byUser.set(userId, []);
          byUser.get(userId).push(transcript);
        } catch {
          unreadable.push(file);
        }
      }
    }
  }
  return { byUser, unreadable };
}

function parseOutput(text) {
  if (typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Same digest the live auditor writes (NutritionAuditor.digestToolCalls). */
function digestToolCall(call) {
  return { name: call?.name ?? call?.toolName ?? 'unknown', args: (JSON.stringify(call?.args ?? {}) ?? '').slice(0, 200) };
}

/** Price one transcript. Null usage (a turn cut off before a response) costs 0, as in the live recorder. */
function turnCost(transcript) {
  const usage = transcript.output?.usage;
  if (!usage) return 0;
  return estimateCostUsd(transcript.model?.name, {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    cachedTokens: usage.cachedInputTokens ?? 0,
  });
}

const time = t => Date.parse(t?.startedAt) || 0;

/**
 * Group one user's transcripts into journal rows, one per runId.
 * @returns {{ rows: object[], withoutRunId: number, unpriced: string[] }}
 */
export function buildRows(transcripts) {
  const runs = new Map();
  let withoutRunId = 0;
  for (const t of transcripts) {
    const runId = t?.input?.context?.runId;
    if (!runId) { withoutRunId++; continue; }
    if (!runs.has(runId)) runs.set(runId, []);
    runs.get(runId).push(t);
  }

  const rows = [];
  const unpriced = [];
  for (const [runId, turns] of runs) {
    turns.sort((a, b) => time(a) - time(b));
    const last = turns[turns.length - 1];
    const usage = { input: 0, cached: 0, output: 0 };
    let costUsd = 0;
    let priced = true;
    for (const t of turns) {
      const u = t.output?.usage || {};
      usage.input += Number(u.inputTokens) || 0;
      usage.cached += Number(u.cachedInputTokens) || 0;
      usage.output += Number(u.outputTokens) || 0;
      const cost = turnCost(t);
      if (cost == null) priced = false;
      else costUsd += cost;
    }
    if (!priced) unpriced.push(runId);
    const completedAt = turns.map(t => t.completedAt).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null;
    const output = parseOutput(last.output?.text);
    rows.push({
      runId,
      at: new Date(time(turns[0])).toISOString(),
      completedAt,
      status: last.status === 'ok' ? 'completed' : 'failed',
      trigger: runId.startsWith('answer_') ? ['answer'] : ['unknown'],
      backfilled: true,
      model: last.model?.name ?? null,
      usage,
      costUsd: priced ? Math.round(costUsd * 1e9) / 1e9 : null,
      turnId: last.turnId ?? null,
      attempts: turns.length,
      toolCalls: turns.flatMap(t => (Array.isArray(t.toolCalls) ? t.toolCalls : []).map(digestToolCall)),
      summary: typeof output?.summary === 'string' ? output.summary : null,
      proposals: Array.isArray(output?.repairs) ? output.repairs : [],
      questions: (Array.isArray(output?.questions) ? output.questions : []).map(q => ({
        question: q?.question ?? null,
        choices: (Array.isArray(q?.choices) ? q.choices : []).map(c => (typeof c === 'string' ? c : c?.label ?? null)),
      })),
    });
  }
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { rows, withoutRunId, unpriced };
}

const STATE_FINISHED = new Set(['completed', 'failed', 'cancelled']);

/**
 * The finished runs in one user's cleanup state file, keyed by run id. A
 * missing file is no runs; an unreadable one throws (a silent empty read would
 * write rows without their outcomes).
 * @returns {Map<string, object>}
 */
export function readStateRuns(stateFile) {
  if (!existsSync(stateFile)) return new Map();
  const state = yaml.load(readFileSync(stateFile, 'utf8')) || {};
  const runs = state.runs && typeof state.runs === 'object' ? Object.values(state.runs) : [];
  return new Map(runs.filter(run => run?.id && STATE_FINISHED.has(run.status)).map(run => [String(run.id), run]));
}

/** The state file YamlAgentStateStore reads for a user. */
export function defaultStateFile(dataDir, userId) {
  const dataService = { user: { resolveDir: (rel, id) => path.join(dataDir, 'users', id, rel) } };
  return new YamlAgentStateStore({ dataService }).path(userId) + '.yml';
}

/**
 * Merge a user's transcript rows with their state runs. The state's recorded
 * values win; transcripts keep usage, cost, tool calls, model and questions.
 * @returns {{ rows: object[], counts: { both: number, stateOnly: number, transcriptOnly: number } }}
 */
export function mergeRows(transcriptRows, stateRuns, { since = DEFAULT_SINCE } = {}) {
  const counts = { both: 0, stateOnly: 0, transcriptOnly: 0 };
  const rows = [];
  const seen = new Set();
  for (const row of transcriptRows) {
    const run = stateRuns.get(row.runId);
    seen.add(row.runId);
    if (!run) { counts.transcriptOnly++; rows.push(row); continue; }
    counts.both++;
    rows.push(fromState(run, row));
  }
  for (const [runId, run] of stateRuns) {
    if (seen.has(runId)) continue;
    const at = Date.parse(run.createdAt);
    if (Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) < since) continue;
    counts.stateOnly++;
    rows.push(fromState(run, null));
  }
  rows.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  return { rows, counts };
}

function fromState(run, transcriptRow) {
  const { proposals, ...base } = transcriptRow || {
    runId: String(run.id), backfilled: true, model: run.model ?? null, usage: null, costUsd: null,
    turnId: null, attempts: Number(run.attempt) || 0, toolCalls: [], questions: [],
  };
  const row = { ...base, runId: String(run.id), backfilled: true, __source: transcriptRow ? 'both' : 'state' };
  const trigger = Array.isArray(run.trigger) && run.trigger.length ? run.trigger : null;
  row.trigger = trigger ?? base.trigger ?? (row.runId.startsWith('answer_') ? ['answer'] : ['unknown']);
  const at = Date.parse(run.createdAt);
  if (Number.isFinite(at)) row.at = new Date(at).toISOString();
  row.completedAt = run.completedAt ?? base.completedAt ?? null;
  row.status = run.status;
  if (run.error != null) row.error = run.error; else delete row.error;
  if (Array.isArray(run.outcomes)) row.outcomes = run.outcomes;
  else if (proposals?.length) row.proposals = proposals;
  row.summary = typeof run.summary === 'string' ? run.summary : (base.summary ?? null);
  if (typeof run.dryRun === 'boolean') row.dryRun = run.dryRun;
  if (typeof run.manual === 'boolean') row.manual = run.manual;
  if (run.overCap) row.overCap = true;
  if (!row.model && run.model) row.model = run.model;
  return row;
}

/**
 * Backfill every user found. Returns the totals; writes nothing when dryRun.
 */
export async function backfill({ mediaDir, dataDir, since = DEFAULT_SINCE, user = null, stateFile = null, dryRun = false, out = console.log }) {
  if (stateFile && !user) throw new Error('stateFile needs a user');
  const dataService = { user: { resolveDir: (rel, id) => path.join(dataDir, 'users', id, rel) } };
  const store = new JsonlAuditJournalStore({ dataService, source: 'backfill' });
  const { byUser, unreadable } = readTranscripts(mediaDir, { since, user });
  const totals = { users: 0, transcripts: 0, runs: 0, written: 0, skipped: 0, withoutRunId: 0, unreadable: unreadable.length, costUsd: 0, unpriced: [],
    stateRuns: 0, both: 0, stateOnly: 0, transcriptOnly: 0, stateFiles: [] };

  // Users with transcripts, plus users whose state file has runs.
  const users = new Set(byUser.keys());
  if (user) users.add(user);
  else for (const id of listDirs(path.join(dataDir, 'users'))) if (USER_RE.test(id) && existsSync(defaultStateFile(dataDir, id))) users.add(id);

  for (const userId of [...users].sort()) {
    const transcripts = byUser.get(userId) || [];
    const file = stateFile ?? defaultStateFile(dataDir, userId);
    const stateRuns = readStateRuns(file);
    totals.stateFiles.push(`${userId}: ${file} (${existsSync(file) ? `${stateRuns.size} finished runs` : 'missing'})`);
    if (!transcripts.length && !stateRuns.size) continue;
    totals.users++;
    totals.transcripts += transcripts.length;
    totals.stateRuns += stateRuns.size;
    const built = buildRows(transcripts);
    const { withoutRunId, unpriced } = built;
    const { rows, counts } = mergeRows(built.rows, stateRuns, { since });
    totals.both += counts.both; totals.stateOnly += counts.stateOnly; totals.transcriptOnly += counts.transcriptOnly;
    totals.runs += rows.length;
    totals.withoutRunId += withoutRunId;
    totals.unpriced.push(...unpriced.map(runId => `${userId}/${runId}`));
    const present = new Set((await store.list(userId)).map(row => row.runId).filter(Boolean));
    for (const row of rows) {
      if (present.has(row.runId)) { totals.skipped++; continue; }
      totals.written++;
      totals.costUsd += row.costUsd ?? 0;
      if (dryRun) {
        const source = { both: 'state+transcript', state: 'state only' }[row.__source] ?? 'transcript only';
        const cost = row.costUsd == null ? (row.usage ? 'unpriced' : 'no usage') : `$${row.costUsd.toFixed(4)}`;
        const result = Array.isArray(row.outcomes) ? `outcomes=${row.outcomes.length}` : `proposals=${(row.proposals || []).length}`;
        out(`${userId}  ${row.at}  ${row.runId}  ${row.status}  [${source}]  attempts=${row.attempts}  ${cost}  `
          + `tools=${row.toolCalls.length} ${result} questions=${row.questions.length}`);
      } else {
        const { __source, ...stored } = row;
        await store.append(userId, stored);
      }
    }
  }
  totals.costUsd = Math.round(totals.costUsd * 1e6) / 1e6;
  return { ...totals, unreadableFiles: unreadable };
}

export function formatSummary(t, { dryRun = false } = {}) {
  const lines = [
    `${dryRun ? 'DRY RUN — nothing written' : 'Backfill complete'}`,
    `  users:                   ${t.users}`,
    `  transcripts read:        ${t.transcripts}`,
    `  state runs read:         ${t.stateRuns}`,
    `  runs found:              ${t.runs}`,
    `    from state+transcript: ${t.both}`,
    `    state only:            ${t.stateOnly} (no transcript: usage and cost left empty)`,
    `    transcript only:       ${t.transcriptOnly} (no state run: repairs kept as proposals)`,
    `  ${dryRun ? 'would write' : 'written'}:${dryRun ? '             ' : '                 '}${t.written}`,
    `  skipped (in journal):    ${t.skipped}`,
    `  transcripts w/o runId:   ${t.withoutRunId}`,
    `  unreadable transcripts:  ${t.unreadable}`,
    `  cost of ${dryRun ? 'rows to write' : 'written rows'}: $${t.costUsd.toFixed(4)}`,
    `  unpriced runs:           ${t.unpriced.length}${t.unpriced.length ? ` (${t.unpriced.join(', ')})` : ''}`,
  ];
  return lines.join('\n');
}

// ============================================================================
// CLI
// ============================================================================

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function basePath() {
  if (process.env.DAYLIGHT_BASE_PATH) return process.env.DAYLIGHT_BASE_PATH;
  // A worktree under .worktrees/ has no .env of its own; fall back to the main checkout's.
  for (const envFile of [path.join(REPO_ROOT, '.env'), path.resolve(REPO_ROOT, '..', '..', '.env')]) {
    if (!existsSync(envFile)) continue;
    const m = readFileSync(envFile, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('DAYLIGHT_BASE_PATH is not set (env or .env); pass --media-dir and --data-dir');
}

export async function runCli(argv, out = console.log) {
  const flags = parseArgs(argv);
  if (flags.help) {
    out(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim());
    return null;
  }
  const mediaDir = flags['media-dir'] ?? path.join(basePath(), 'media');
  const dataDir = flags['data-dir'] ?? path.join(basePath(), 'data');
  const totals = await backfill({ mediaDir, dataDir, since: flags.since, user: flags.user ?? null, stateFile: flags['state-file'] ?? null,
    dryRun: flags['dry-run'], out });
  out(formatSummary(totals, { dryRun: flags['dry-run'] }));
  for (const line of totals.stateFiles) out(`  state file ${line}`);
  for (const file of totals.unreadableFiles) out(`  unreadable: ${file}`);
  return totals;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((e) => { console.error(`nutrition-auditor-backfill: ${e.message}`); process.exit(1); });
}
