/**
 * contentfilter review-stats [--since 30d] [--rk <id>] [--json]
 *
 * Read-only: turns the durable human review history
 * (household/content-filter/review-history/<rk>.yml) into correction statistics, so the machine
 * (Jev / deterministic) certification can be refined from what people keep correcting.
 * Counts the NET verdict per row (an `undo` clears the row's mark), not raw entries.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export const REVIEW_STATS_USAGE = `Usage: contentfilter review-stats [--since 30d] [--rk <ratingKey>] [--json]

Human review verdicts as machine-certification feedback: verdict counts by kind / category /
effect / machine stage, remove rate by machine stage and unsure reason, the action-change
matrix (from -> to), redo reasons and median dwell. --since takes Nd | Nh | an ISO date.`;

const DAY = 86400000;

/** "30d" | "12h" | ISO date -> epoch ms cutoff (null = no cutoff). */
export function parseSince(since, now = Date.now()) {
  if (since == null || since === true || since === '') return null;
  if (/^\d+$/.test(String(since).trim())) throw new Error(`Bad --since: ${since} (a bare number is ambiguous; use 30d, 12h or a date)`);
  const m = /^(\d+)\s*([dh])$/i.exec(String(since));
  if (m) return now - Number(m[1]) * (m[2].toLowerCase() === 'd' ? DAY : 3600000);
  const t = Date.parse(String(since));
  if (!Number.isFinite(t)) throw new Error(`Bad --since: ${since} (use 30d, 12h or a date)`);
  return t;
}

/**
 * The row's verdict as the server holds it: one mark per row, a later verdict overwrites, and an
 * `undo` deletes the mark outright (no verdict until a new one is recorded).
 */
export function netVerdicts(entries) {
  const net = new Map();
  for (const e of entries || []) {
    if (!e || !e.rowId) continue;
    if (e.verdict === 'undo') net.delete(e.rowId); else if (e.verdict) net.set(e.rowId, e);
  }
  return [...net.values()];
}

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : Math.round((v[h - 1] + v[h]) / 2);
};
const label = (v) => (v == null || v === '' ? '(none)' : String(v));
const sideLabel = (s) => {
  if (s == null) return '(none)';
  if (typeof s === 'string') return s;
  if (s.effect) return String(s.effect);
  return (s.in != null || s.out != null) ? 'edges' : '(none)';
};
const rateOf = (g) => Object.fromEntries(Object.entries(g).map(([k, b]) => [k, { rows: b.total, removed: b.remove || 0, removeRate: +((b.remove || 0) / b.total).toFixed(3) }]));

/** @returns {object} the stats for already-netted rows */
export function aggregate(rows) {
  const bump = (out, k, verdict) => { const b = (out[k] ||= { total: 0 }); b.total++; b[verdict] = (b[verdict] || 0) + 1; };
  const group = (keyOf) => {
    const out = {};
    for (const r of rows) bump(out, label(keyOf(r)), r.verdict);
    return out;
  };
  const unsure = {};
  for (const r of rows) {
    const keys = Array.isArray(r.machine?.unsure) && r.machine.unsure.length ? r.machine.unsure : ['(sure)'];
    for (const k of keys) bump(unsure, k, r.verdict);
  }
  const changes = {};
  for (const r of rows) {
    if (!r.change) continue;
    const key = `${sideLabel(r.change.from)} -> ${sideLabel(r.change.to)}`;
    changes[key] = (changes[key] || 0) + 1;
  }
  const redoReasons = {};
  const verdicts = {};
  for (const r of rows) {
    verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
    if (r.verdict === 'redo') { const k = label(r.reason); redoReasons[k] = (redoReasons[k] || 0) + 1; }
  }
  const byStage = group((r) => r.machine?.stage);
  return {
    rows: rows.length,
    verdicts,
    byKind: group((r) => r.kind),
    byCategory: group((r) => r.category),
    byEffect: group((r) => r.effect),
    byMachineStage: byStage,
    removeRateByMachineStage: rateOf(byStage),
    removeRateByUnsure: rateOf(unsure),
    changeMatrix: changes,
    redoReasons,
    dwellMs: { median: median(rows.map((r) => r.dwellMs)), n: rows.filter((r) => Number.isFinite(r.dwellMs)).length },
  };
}

/** Read every history file under historyDir (or one rk) and aggregate net verdicts. */
export function runReviewStats({ historyDir, flags = {}, now = Date.now() }) {
  const cutoff = parseSince(flags.since, now);
  const rk = flags.rk != null ? String(flags.rk).replace(/[^0-9A-Za-z_-]/g, '') : null;
  const files = existsSync(historyDir)
    ? readdirSync(historyDir).filter((f) => f.endsWith('.yml') && (!rk || f === `${rk}.yml`)) : [];
  const rows = []; let films = 0;
  for (const f of files) {
    let doc;
    try { doc = yaml.load(readFileSync(path.join(historyDir, f), 'utf8')); } catch { continue; }
    const net = netVerdicts(Array.isArray(doc?.entries) ? doc.entries : [])
      .filter((e) => cutoff == null || Date.parse(e.at) >= cutoff);
    if (net.length) films++;
    rows.push(...net);
  }
  return { films, since: cutoff == null ? null : new Date(cutoff).toISOString(), rk, ...aggregate(rows) };
}

const pad = (s, n) => String(s).padEnd(n);
const pct = (x) => `${Math.round(x * 100)}%`;

export function formatReviewStats(r) {
  const head = `Review stats: ${r.rows} net verdicts across ${r.films} film(s)${r.since ? ` since ${r.since.slice(0, 10)}` : ''}${r.rk ? ` (rk ${r.rk})` : ''}`;
  if (!r.rows) return `${head}\nNo review history found.`;
  const L = [head, `Verdicts: ${Object.entries(r.verdicts).map(([k, n]) => `${k} ${n}`).join(', ')}`];
  const table = (title, g) => {
    L.push('', title);
    for (const [k, b] of Object.entries(g)) L.push(`  ${pad(k, 22)} ${pad(b.total, 5)} ${Object.entries(b).filter(([x]) => x !== 'total').map(([x, n]) => `${x} ${n}`).join(' ')}`);
  };
  table('By kind', r.byKind); table('By category', r.byCategory); table('By effect', r.byEffect); table('By machine stage', r.byMachineStage);
  const rates = (title, g) => { L.push('', title); for (const [k, b] of Object.entries(g)) L.push(`  ${pad(k, 22)} ${pad(`${b.removed}/${b.rows}`, 8)} ${pct(b.removeRate)}`); };
  rates('Remove rate by machine stage', r.removeRateByMachineStage); rates('Remove rate by unsure reason', r.removeRateByUnsure);
  const list = (title, o) => {
    L.push('', title);
    const e = Object.entries(o).sort((a, b) => b[1] - a[1]);
    L.push(...(e.length ? e.map(([k, n]) => `  ${pad(k, 28)} ${n}`) : ['  (none)']));
  };
  list('Action changes (from -> to)', r.changeMatrix); list('Redo reasons', r.redoReasons);
  L.push('', `Median dwell: ${r.dwellMs.median == null ? 'n/a' : `${(r.dwellMs.median / 1000).toFixed(1)} s`} (${r.dwellMs.n} rows)`);
  return L.join('\n');
}
