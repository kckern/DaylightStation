#!/usr/bin/env node

/**
 * OpenAI usage audit — what the provider says we spent, next to what our own
 * ledger says we spent, so a hole in the bucket shows up as a number.
 *
 * Two sources, deliberately kept apart:
 *   - The OpenAI org API (`/v1/organization/*`): costs and token usage per
 *     project, API key, model and day. Needs an ADMIN key (`sk-admin-…`), and an
 *     admin key only sees its own org. A project key cannot read any of this.
 *   - Our ledger: `<dataDir>/system/history/ai-usage/YYYY-MM.<env>.jsonl`, one
 *     row per call the app made (see AiUsageLedger). It knows nothing about
 *     other apps sharing the account.
 *
 * `whoami` is the first thing to run. It asks which org and project the APP key
 * bills to. If that is not the org the admin key belongs to, the org reports
 * describe some other account and cannot explain the app's bill.
 *
 * Usage:
 *   node cli/openai-usage.cli.mjs <command> [options]
 *
 * Commands:
 *   whoami                 Org + project behind the app key and the admin key
 *   projects               Projects in the admin key's org, with their API keys
 *   costs                  Billed dollars (org API), grouped by --by
 *   usage                  Requests and tokens (org API), grouped by --by
 *   ledger                 Our own ledger, grouped by --by
 *   reconcile              Per day: billed dollars vs ledger dollars
 *
 * Options:
 *   --since YYYY-MM-DD     Start date (default: first of the current month)
 *   --until YYYY-MM-DD     End date, exclusive (default: now)
 *   --by <keys>            Comma list. costs: project,line_item,key,day
 *                          usage: project,model,key,day
 *                          ledger: any row field — model,endpoint,status,day,
 *                          app,feature,origin,agentId,writer
 *   --untagged             ledger: only rows no app claimed (app null),
 *                          grouped by origin — where the untagged spend came from
 *   --project <id>         Limit org reports / reconcile to one project
 *   --json                 Raw JSON output
 *
 * Keys (never pass a key value on the command line):
 *   app key    `api_key:` in <dataDir>/system/auth/openai.yml (the key the system
 *              calls OpenAI with), or $OPENAI_API_KEY. Used for everything by default.
 *   admin key  Only if the app key lacks api.usage.read: `admin_key:` in the same
 *              file, $OPENAI_ADMIN_KEY, or --admin-key-file <path>. It must come
 *              from the app key's org, or the reports describe another account.
 *   dataDir    $DAYLIGHT_BASE_PATH/data (read from .env when unset)
 *
 * Examples:
 *   node cli/openai-usage.cli.mjs whoami
 *   node cli/openai-usage.cli.mjs costs --since 2026-09-01 --by project,line_item
 *   node cli/openai-usage.cli.mjs usage --by day,key,model
 *   node cli/openai-usage.cli.mjs reconcile --since 2026-09-01
 *   node cli/openai-usage.cli.mjs ledger --by app,feature
 *   node cli/openai-usage.cli.mjs ledger --untagged
 *
 * @module cli/openai-usage
 */

import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const API = 'https://api.openai.com/v1';
const DAY_S = 86400;

// ============================================================================
// Pure helpers (exported for tests)
// ============================================================================

export function parseArgs(argv) {
  const flags = { json: false };
  const positional = [];
  const withValue = new Set(['since', 'until', 'by', 'project', 'admin-key-file']);
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { positional.push(tok); continue; }
    const key = tok.slice(2);
    if (withValue.has(key)) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { command: positional[0] || null, flags };
}

/** Unix seconds for a YYYY-MM-DD (UTC midnight); the org API buckets by UTC day. */
export function toUnix(date) {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Bad date: ${date} (want YYYY-MM-DD)`);
  return Math.floor(ms / 1000);
}

export function defaultSince(now = new Date()) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/**
 * Sum rows into groups. `keyFns` maps a group name to a row → string function;
 * `sumFns` maps an output column to a row → number function.
 */
export function groupRows(rows, keyFns, sumFns) {
  const groups = new Map();
  for (const row of rows) {
    const key = Object.entries(keyFns).map(([name, fn]) => [name, fn(row) ?? '-']);
    const id = JSON.stringify(key);
    if (!groups.has(id)) groups.set(id, { ...Object.fromEntries(key), ...Object.fromEntries(Object.keys(sumFns).map(k => [k, 0])) });
    const g = groups.get(id);
    for (const [col, fn] of Object.entries(sumFns)) g[col] += Number(fn(row)) || 0;
  }
  return [...groups.values()];
}

const dayOf = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);

/** Flatten org API buckets to rows carrying their bucket day. */
export function flattenBuckets(pages) {
  return pages.flatMap(bucket => (bucket.results || []).map(r => ({ ...r, day: dayOf(bucket.start_time) })));
}

/** Read ledger rows in [since, until) from every monthly file, every writer. */
export function readLedger(ledgerDir, since, until) {
  if (!existsSync(ledgerDir)) return [];
  const lo = since ? `${since}T00:00:00` : '';
  const hi = until ? `${until}T00:00:00` : '￿';
  const rows = [];
  for (const file of readdirSync(ledgerDir).filter(f => f.endsWith('.jsonl')).sort()) {
    const writer = file.replace(/^\d{4}-\d{2}\./, '').replace(/\.jsonl$/, '');
    for (const line of readFileSync(path.join(ledgerDir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.ts >= lo && row.ts < hi) rows.push({ ...row, writer, day: row.ts.slice(0, 10) });
    }
  }
  return rows;
}

/** Join billed dollars and ledger dollars per day. */
export function reconcileByDay(costRows, ledgerRows) {
  const days = new Map();
  const at = (day) => days.get(day) || days.set(day, { day, billedUsd: 0, ledgerUsd: 0, ledgerCalls: 0, ledgerErrors: 0 }).get(day);
  for (const r of costRows) at(r.day).billedUsd += Number(r.amount?.value) || 0;
  for (const r of ledgerRows) {
    const d = at(r.day);
    d.ledgerUsd += Number(r.costUsd) || 0;
    d.ledgerCalls += 1;
    if (r.status === 'error') d.ledgerErrors += 1;
  }
  return [...days.values()]
    .map(d => ({ ...d, gapUsd: d.billedUsd - d.ledgerUsd }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

const LEDGER_EMPTY_LABEL = Object.freeze({ app: '(untagged)', feature: '(no feature)', origin: '(no origin)' });

/**
 * Group ledger rows for the `ledger` command.
 * @param {Object[]} rows - from readLedger
 * @param {Object} opts
 * @param {string[]} [opts.by] - row fields to group by (default model; `--untagged` defaults to origin)
 * @param {boolean} [opts.untagged] - keep only rows with no app, grouped by origin
 * @returns {{ rows: Object[], columns: string[], total: number, calls: number }}
 */
export function summarizeLedger(rows, { by = null, untagged = false } = {}) {
  const list = (by || (untagged ? 'origin' : 'model')).split(',').map(s => s.trim()).filter(Boolean);
  const picked = untagged ? rows.filter(r => r.app == null) : rows;
  const label = (k) => (r) => r[k] ?? LEDGER_EMPTY_LABEL[k] ?? null;
  const grouped = groupRows(picked, Object.fromEntries(list.map(k => [k, label(k)])), {
    calls: () => 1, errors: r => r.status === 'error', tokens: r => r.totalTokens, usd: r => r.costUsd,
    unpriced: r => r.status === 'ok' && r.costUsd == null,
  }).sort((a, b) => list[0] === 'day' ? String(a.day).localeCompare(String(b.day)) : b.usd - a.usd || b.calls - a.calls);
  return {
    rows: grouped,
    columns: [...list, 'calls', 'errors', 'tokens', 'usd', 'unpriced'],
    total: grouped.reduce((sum, r) => sum + r.usd, 0),
    calls: picked.length,
  };
}

export function formatTable(rows, columns) {
  if (!rows.length) return '(no rows)';
  const fmt = (v) => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v ?? '-');
  const widths = columns.map(c => Math.max(c.length, ...rows.map(r => fmt(r[c]).length)));
  const line = (cells) => cells.map((c, i) => (typeof c === 'number' ? fmt(c).padStart(widths[i]) : fmt(c).padEnd(widths[i]))).join('  ');
  return [line(columns), line(widths.map(w => '-'.repeat(w))), ...rows.map(r => line(columns.map(c => r[c])))].join('\n');
}

// ============================================================================
// Environment: data dir and keys
// ============================================================================

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function dataDir() {
  let base = process.env.DAYLIGHT_BASE_PATH;
  if (!base) {
    const envFile = path.join(REPO_ROOT, '.env');
    if (existsSync(envFile)) {
      const m = readFileSync(envFile, 'utf8').match(/^DAYLIGHT_BASE_PATH=(.*)$/m);
      if (m) base = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!base) throw new Error('DAYLIGHT_BASE_PATH is not set (env or .env)');
  return path.join(base, 'data');
}

function authFile() {
  const file = path.join(dataDir(), 'system/auth/openai.yml');
  return existsSync(file) ? (YAML.parse(readFileSync(file, 'utf8')) || {}) : {};
}

/**
 * The key the org reports are read with. Defaults to the system's own key so
 * the reports describe the org this system bills to; an admin key from that
 * same org is only needed when the system key lacks the usage scopes.
 */
function adminKey(flags) {
  if (flags['admin-key-file']) return readFileSync(flags['admin-key-file'], 'utf8').trim();
  const key = process.env.OPENAI_ADMIN_KEY || authFile().admin_key;
  return key ? String(key).trim() : appKey();
}

function appKey() {
  const key = authFile().api_key || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('No app key in system/auth/openai.yml (api_key) or $OPENAI_API_KEY');
  return String(key).trim();
}

// ============================================================================
// OpenAI calls
// ============================================================================

async function getJson(url, key) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.error : body.error?.message || res.statusText;
    const hint = /Missing scopes: api\.(usage|management)\.read/.test(msg)
      ? '\n  This key cannot read org reports. Create an admin key (sk-admin-…) in the SAME org as system/auth/openai.yml'
        + ' (platform.openai.com → Settings → Admin keys) and put it in that file as admin_key.'
      : '';
    throw new Error(`${res.status} ${url.replace(API, '')}: ${msg}${hint}`);
  }
  return { body, headers: res.headers };
}

/** Page through an org report endpoint; `limit` caps at 31 for 1d buckets. */
async function orgReport(endpoint, key, { since, until, groupBy, project }) {
  const params = new URLSearchParams({ start_time: String(toUnix(since)), bucket_width: '1d', limit: '31' });
  if (until) params.set('end_time', String(toUnix(until)));
  for (const g of groupBy) params.append('group_by[]', g);
  if (project) params.append('project_ids[]', project);
  const buckets = [];
  let page = null;
  do {
    if (page) params.set('page', page);
    const { body } = await getJson(`${API}/organization/${endpoint}?${params}`, key);
    buckets.push(...(body.data || []));
    page = body.has_more ? body.next_page : null;
  } while (page);
  return flattenBuckets(buckets);
}

/**
 * Which org/project a key bills to. The org header only comes back on an
 * inference call, so this spends one output token on the cheapest model.
 */
async function identifyProjectKey(key) {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4.1-nano', messages: [{ role: 'user', content: '.' }], max_tokens: 1 }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    organization: res.headers.get('openai-organization'),
    project: res.headers.get('openai-project'),
    ...(res.ok ? {} : { error: body.error?.message }),
  };
}

async function identifyAdminKey(key) {
  const { headers } = await getJson(`${API}/organization/projects?limit=1`, key);
  return { organization: headers.get('openai-organization') };
}

async function namesFor(key) {
  const { body } = await getJson(`${API}/organization/projects?limit=100&include_archived=true`, key);
  const projects = body.data || [];
  const keys = {};
  for (const p of projects) {
    const { body: kb } = await getJson(`${API}/organization/projects/${p.id}/api_keys?limit=100`, key);
    for (const k of kb.data || []) keys[k.id] = { ...k, project: p };
  }
  return { projects, keys };
}

// ============================================================================
// Commands
// ============================================================================

const COST_KEYS = { project: 'project_id', line_item: 'line_item', key: 'api_key_id' };
const USAGE_KEYS = { project: 'project_id', model: 'model', key: 'api_key_id' };

function pickGroups(by, allowed, fallback) {
  const list = (by || fallback).split(',').map(s => s.trim()).filter(Boolean);
  for (const k of list) if (k !== 'day' && !allowed[k]) throw new Error(`--by ${k} not supported here (use: day,${Object.keys(allowed).join(',')})`);
  return list;
}

function labelFns(list, allowed, names) {
  const projectName = (id) => names?.projects.find(p => p.id === id)?.name || id;
  const keyName = (id) => names?.keys[id]?.name ? `${names.keys[id].name} (…${names.keys[id].redacted_value?.slice(-4)})` : id;
  return Object.fromEntries(list.map(k => [k, k === 'day' ? (r) => r.day
    : k === 'project' ? (r) => projectName(r.project_id)
    : k === 'key' ? (r) => keyName(r.api_key_id)
    : (r) => r[allowed[k]]]));
}

export async function runCli(argv, out = console.log) {
  const { command, flags } = parseArgs(argv);
  const since = flags.since || defaultSince();
  const until = flags.until || null;
  const emit = (rows, columns, footer) => {
    if (flags.json) return out(JSON.stringify(rows, null, 2));
    out(formatTable(rows, columns));
    if (footer) out(footer);
  };

  switch (command) {
    case 'whoami': {
      const app = await identifyProjectKey(appKey()).catch(e => ({ error: e.message }));
      let admin = null;
      try { admin = await identifyAdminKey(adminKey(flags)); } catch (e) { admin = { error: e.message }; }
      const sameOrg = app.organization && admin?.organization && app.organization === admin.organization;
      const result = { appKey: app, adminKey: admin, sameOrg: !!sameOrg };
      if (flags.json) return out(JSON.stringify(result, null, 2));
      out(`app key   org=${app.organization ?? '?'}  project=${app.project ?? '?'}${app.error ? `  error=${app.error}` : ''}`);
      out(`admin key org=${admin?.organization ?? '?'}${admin?.error ? `  error=${admin.error}` : ''}`);
      out(admin?.error ? 'No org reports: the report key was refused (see above).'
        : sameOrg ? 'Same org: the org reports cover the app\'s spend.'
        : 'DIFFERENT orgs: the org reports cannot see the app\'s spend. Use an admin key from the app key\'s org.');
      return;
    }

    case 'projects': {
      const names = await namesFor(adminKey(flags));
      const rows = Object.values(names.keys).map(k => ({
        project: k.project.name, project_id: k.project.id, key: k.name, key_id: k.id,
        tail: `…${k.redacted_value?.slice(-4) ?? ''}`,
        created: dayOf(k.created_at), last_used: k.last_used_at ? dayOf(k.last_used_at) : 'never',
      }));
      for (const p of names.projects) if (!rows.some(r => r.project_id === p.id)) rows.push({ project: p.name, project_id: p.id, key: '(no keys)' });
      return emit(rows, ['project', 'project_id', 'key', 'key_id', 'tail', 'created', 'last_used']);
    }

    case 'costs': {
      const key = adminKey(flags);
      const list = pickGroups(flags.by, COST_KEYS, 'project,line_item');
      // The costs endpoint groups by at most project_id + line_item; key-level
      // cost is not offered, so --by key reads usage instead.
      if (list.includes('key')) throw new Error('costs cannot group by key; use `usage --by key`');
      const rows = await orgReport('costs', key, { since, until, project: flags.project, groupBy: list.filter(k => k !== 'day').map(k => COST_KEYS[k]) });
      const names = list.includes('project') ? await namesFor(key) : null;
      const grouped = groupRows(rows, labelFns(list, COST_KEYS, names), { usd: r => r.amount?.value })
        .filter(r => r.usd > 0.00005).sort((a, b) => list[0] === 'day' ? a.day.localeCompare(b.day) : b.usd - a.usd);
      const total = grouped.reduce((s, r) => s + r.usd, 0);
      return emit(grouped, [...list, 'usd'], `\nTotal billed ${since} → ${until || 'now'}: $${total.toFixed(2)}`);
    }

    case 'usage': {
      const key = adminKey(flags);
      const list = pickGroups(flags.by, USAGE_KEYS, 'project,model');
      const rows = await orgReport('usage/completions', key, { since, until, project: flags.project, groupBy: list.filter(k => k !== 'day').map(k => USAGE_KEYS[k]) });
      const names = list.some(k => k === 'project' || k === 'key') ? await namesFor(key) : null;
      const grouped = groupRows(rows, labelFns(list, USAGE_KEYS, names), {
        requests: r => r.num_model_requests, input: r => r.input_tokens, cached: r => r.input_cached_tokens, output: r => r.output_tokens,
      }).filter(r => r.requests > 0).sort((a, b) => list[0] === 'day' ? a.day.localeCompare(b.day) : b.input + b.output - a.input - a.output);
      return emit(grouped, [...list, 'requests', 'input', 'cached', 'output']);
    }

    case 'ledger': {
      const rows = readLedger(path.join(dataDir(), 'system/history/ai-usage'), since, until);
      const summary = summarizeLedger(rows, { by: flags.by, untagged: !!flags.untagged });
      const what = flags.untagged ? 'Untagged (no app)' : 'Ledger total';
      return emit(summary.rows, summary.columns,
        `\n${what} ${since} → ${until || 'now'}: $${summary.total.toFixed(2)} over ${summary.calls} calls (unpriced rows count $0)`);
    }

    case 'reconcile': {
      const key = adminKey(flags);
      const app = await identifyProjectKey(appKey());
      const admin = await identifyAdminKey(key);
      const project = flags.project || app.project;
      if (app.organization !== admin.organization) {
        out(`WARNING: the app key bills to org ${app.organization}, the admin key reads org ${admin.organization}.`);
        out('Billed dollars below are NOT the app\'s bill. Use an admin key from the app key\'s org.\n');
      }
      const costRows = await orgReport('costs', key, { since, until, project, groupBy: ['project_id'] });
      const ledgerRows = readLedger(path.join(dataDir(), 'system/history/ai-usage'), since, until);
      const days = reconcileByDay(costRows, ledgerRows);
      const sum = (k) => days.reduce((s, d) => s + d[k], 0);
      return emit(days, ['day', 'billedUsd', 'ledgerUsd', 'gapUsd', 'ledgerCalls', 'ledgerErrors'],
        `\nproject ${project}: billed $${sum('billedUsd').toFixed(2)}, ledger $${sum('ledgerUsd').toFixed(2)}, gap $${sum('gapUsd').toFixed(2)}`);
    }

    default:
      out(readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '').trim());
      if (command) process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((e) => { console.error(`openai-usage: ${e.message}`); process.exit(1); });
}
