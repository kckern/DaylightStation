#!/usr/bin/env node
/**
 * Plan an untracked-intake reconstruction (docs/runbooks/health-untracked-reconstruction.md).
 *
 * Reads an EXPORT directory (copies of the user's lifelog files; this never
 * touches live data) and writes a plan: one entry per unlogged or partial day
 * (logged < --min) whose calories are the weight-derived estimate minus what
 * was logged. The plan is reviewed, then POSTed to
 * /api/v1/health/nutrition/reconstruction, which writes it through the ledger.
 *
 *   estimate = RMR x 1.1 (TEF) + step NEAT + net exercise + weight balance
 *   RMR      = DEXA RMR x scale lean mass(day) / scale lean mass(DEXA week)
 *   NEAT     = steps x kg x 0.0005 (missing/corrupt days: mean of valid days +-45d)
 *   exercise = max over sources of (workout kcal - resting kcal for its minutes);
 *              HR-only workouts via the Keytel formula
 *   balance  = 14-day slope of a 15-day centered weight trend x 3500 kcal/lb
 *
 * Usage:
 *   node cli/health-reconstruct-untracked.cli.mjs --export <dir> --from 2025-06-01 --to 2026-07-31 \
 *     --dexa-date 2025-01-15 --dexa-rmr 1622 --age 41 --out plan.json [--min 1200] \
 *     [--corrupt-fitness 2025-12-23:2026-01-24]
 *
 * <dir> holds withings.yml, nutriday.yml, health.yml, fitness*.yml (archives +
 * current), garmin*.yml and strava_arch.yml (a multi-document concatenation of
 * lifelog/archives/strava/*.yml). The runbook shows the export commands.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
// Only a DAY status closes a day; a record holding only meal fasts does not.
import { closureStatus, fastedMealsOf } from '#apps/coaching/dayCompleteness.mjs';

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1]; });
for (const need of ['export', 'from', 'to', 'dexa-date', 'dexa-rmr', 'age', 'out']) if (!args[need]) { console.error(`missing --${need}`); process.exit(2); }
const S = path.resolve(args.export);
const L = f => fs.existsSync(`${S}/${f}`) ? (yaml.load(fs.readFileSync(`${S}/${f}`, 'utf8')) || {}) : {};
const byPrefix = prefix => Object.assign({}, ...fs.readdirSync(S).filter(f => f.startsWith(prefix) && f.endsWith('.yml')).sort().map(L));
const withings = L('withings.yml'), nutriday = L('nutriday.yml'), health = L('health.yml');
// Days the user closed with /done or /fast (or the day view) are final: never filled.
const closures = L('day_closed.yml');
const [corruptFrom, corruptTo] = (args['corrupt-fitness'] || ':').split(':');
// A known sync window that duplicated activities and summed step totals is dropped, not trusted.
const fitness = Object.fromEntries(Object.entries(byPrefix('fitness')).filter(([d]) => !(corruptFrom && d >= corruptFrom && d <= corruptTo)));
const garmin = byPrefix('garmin');
const stravaArch = fs.existsSync(`${S}/strava_arch.yml`) ? yaml.loadAll(fs.readFileSync(`${S}/strava_arch.yml`, 'utf8')).filter(Boolean) : [];
const START = args.from, END = args.to, MIN = Number(args.min || 1200), AGE = Number(args.age);
const DEXA = { date: args['dexa-date'], rmr: Number(args['dexa-rmr']) };
// 1.1 = RMR + thermic effect of food, with ALL movement counted explicitly
// (steps, workouts). It is a deliberate LOWER bound: the user's well-logged
// days imply 0.98 — below the DEXA-measured RMR, i.e. those days under-log
// too — so calibrating on them would bake the under-logging back in.
const FACTOR = 1.1;
const day = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const range = (a, b) => { const o = []; for (let d = a; d <= b; d = day(d, 1)) o.push(d); return o; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

// ── weight trend + lean mass ──
const raw = {}; for (const r of withings) if (r.date && r.lbs) (raw[r.date] ??= []).push(r);
const series = key => { const o = {}; for (const [d, rs] of Object.entries(raw)) { const v = rs.map(key).filter(Number.isFinite); if (v.length) o[d] = mean(v); } return o; };
const wRaw = series(r => r.lbs), ffmRaw = series(r => r.lean_lbs ?? (r.fat_percent != null ? r.lbs * (1 - r.fat_percent / 100) : NaN));
const interp = (pts, days) => { const known = Object.keys(pts).sort(); const out = {}; for (const d of days) { if (pts[d] != null) { out[d] = pts[d]; continue; }
  const prev = known.filter(k => k < d).at(-1), next = known.find(k => k > d);
  out[d] = prev && next ? pts[prev] + (new Date(d) - new Date(prev)) / (new Date(next) - new Date(prev)) * (pts[next] - pts[prev]) : pts[prev ?? next]; } return out; };
const centered = (s, days, h) => { const o = {}; days.forEach((d, i) => { o[d] = mean(days.slice(Math.max(0, i - h), i + h + 1).map(x => s[x])); }); return o; };
const span = range(day(START, -60), day(END, 60));
const weightTrend = centered(interp(wRaw, span), span, 7), ffm = centered(interp(ffmRaw, span), span, 15);
const scaleFfmAtScan = mean(range(day(DEXA.date, -7), day(DEXA.date, 7)).map(d => ffmRaw[d]).filter(Number.isFinite));

// ── exercise: net of resting burn, one total per source, max across sources (they overlap) ──
const keytel = (hr, min, kg) => (!hr || !min) ? 0 : Math.max(0, (-55.0969 + 0.6309 * hr + 0.1988 * kg + 0.2017 * AGE) / 4.184 * min);
const exercise = (d, rmr, kg) => {
  const restPerMin = rmr / 1440;
  const net = (gross, min) => Math.max(0, gross - restPerMin * (min || 0));
  const g = (garmin[d] || []).reduce((s, a) => s + Math.max(0, (a.calories || 0) - (a.bmrCalories ?? restPerMin * (a.duration || 0))), 0);
  const seen = new Set();
  const f = (fitness[d]?.activities || []).filter(a => { const k = `${a.title}|${a.minutes}|${a.calories}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .reduce((s, a) => s + net(a.calories || keytel(a.avgHeartrate, a.minutes, kg), a.minutes), 0);
  const sa = stravaArch.filter(x => x.date === d).reduce((s, x) => { const min = (x.data?.moving_time || 0) / 60; return s + net(x.data?.calories || keytel(x.data?.average_heartrate, min, kg), min); }, 0);
  const hw = (health[d]?.workouts || []).reduce((s, w) => { const min = w.duration || w.strava?.minutes || 0; return s + net(w.calories || keytel(w.avgHr || w.strava?.avgHeartrate, min, kg), min); }, 0);
  // Steps taken DURING workouts are already in the exercise figure; NEAT must
  // exclude them. Garmin records them per activity; otherwise walks/runs are
  // estimated at a cadence per minute.
  const CADENCE = { Run: 160, Walk: 110, Hike: 100 };
  const garminSteps = (garmin[d] || []).reduce((s, a) => s + (Number(a.steps) || 0), 0);
  const cadenceSteps = [...stravaArch.filter(x => x.date === d).map(x => ({ type: x.type, min: (x.data?.moving_time || 0) / 60 })),
    ...(health[d]?.workouts || []).map(w => ({ type: w.type || w.strava?.type, min: w.duration || w.strava?.minutes || 0 }))]
    .reduce((s, w) => s + (CADENCE[w.type] || 0) * w.min, 0);
  return { total: Math.max(g, f, sa, hw), workoutSteps: garminSteps || cadenceSteps, src: { garmin: g, fitness: f, stravaArchive: sa, health: hw } };
};

// ── steps → NEAT (≈0.0005 kcal per step per kg); invalid or missing days imputed from nearby valid days ──
const stepsRaw = {}; for (const [d, v] of Object.entries(fitness)) { const c = v?.steps?.steps_count; if (c > 300 && c < 40000) stepsRaw[d] = c; }
const validSteps = Object.values(stepsRaw); const globalSteps = mean(validSteps);
const stepsFor = d => { if (stepsRaw[d] != null) return { steps: stepsRaw[d], imputed: false };
  const near = range(day(d, -45), day(d, 45)).map(x => stepsRaw[x]).filter(Number.isFinite);
  return { steps: near.length >= 10 ? mean(near) : globalSteps, imputed: true }; };

const rows = [];
for (const d of range(START, END)) {
  const kg = weightTrend[d] / 2.2046;
  const rmr = DEXA.rmr * ffm[d] / scaleFfmAtScan;
  const ex = exercise(d, rmr, kg);
  const st = stepsFor(d);
  const neat = Math.max(0, st.steps - (st.imputed ? 0 : ex.workoutSteps)) * kg * 0.0005;
  const balance = (weightTrend[day(d, 7)] - weightTrend[day(d, -7)]) / 14 * 3500;
  const estimate = Math.round(rmr * FACTOR + neat + ex.total + balance);
  // A day with no usable weight or lean mass must stop the run, not vanish from the plan.
  if (!Number.isFinite(estimate)) throw new Error(`${d}: estimate is not a number (rmr ${rmr}, neat ${neat}, exercise ${ex.total}, balance ${balance}) — check the export`);
  const logged = Math.round(Number(nutriday[d]?.calories) || 0);
  // Closed = a DAY status (done/fasting, or the legacy bare `true`); a record
  // that only lists fasted meals does not close the day.
  const status = closureStatus(closures[d]) || fastedMealsOf(closures[d]).length ? 'closed' : logged <= 0 ? 'unlogged' : logged < MIN ? 'incomplete' : 'complete';
  rows.push({ date: d, status, logged, estimate, fill: status === 'complete' || status === 'closed' ? 0 : Math.max(0, estimate - logged),
    rmr: Math.round(rmr), neat: Math.round(neat), steps: Math.round(st.steps), stepsImputed: st.imputed, exercise: Math.round(ex.total), exerciseSrc: ex.src,
    balance: Math.round(balance), weightTrend: +weightTrend[d].toFixed(1) });
}
console.error(`scale FFM @DEXA ${scaleFfmAtScan.toFixed(1)} lb · valid step days ${validSteps.length} (mean ${Math.round(globalSteps)})`);
const by = {}; for (const r of rows) { const m = r.date.slice(0, 7); const b = (by[m] ??= { n: 0, unl: 0, inc: 0, logged: 0, est: 0, fill: 0, rmr: 0, neat: 0, ex: 0, bal: 0, stImp: 0 });
  b.n++; if (r.status === 'unlogged') b.unl++; if (r.status === 'incomplete') b.inc++; b.logged += r.logged; b.est += r.estimate; b.fill += r.fill; b.rmr += r.rmr; b.neat += r.neat; b.ex += r.exercise; b.bal += r.balance; if (r.stepsImputed) b.stImp++; }
const a = (b, k) => String(Math.round(b[k] / b.n)).padStart(5);
console.error('month   unl inc | RMR×1.1  steps  exer  bal | est  logged  after | stepsImputed');
for (const [m, b] of Object.entries(by)) console.error(`${m}  ${String(b.unl).padStart(3)} ${String(b.inc).padStart(3)} | ${String(Math.round(b.rmr / b.n * 1.1)).padStart(7)} ${a(b, 'neat')} ${a(b, 'ex')} ${a(b, 'bal')} | ${a(b, 'est')} ${a(b, 'logged')} ${String(Math.round((b.logged + b.fill) / b.n)).padStart(6)} | ${b.stImp}`);
const filled = rows.filter(r => r.fill > 0); const fs2 = filled.map(r => r.fill).sort((x, y) => x - y);
console.error(`filled ${filled.length} days; total ${fs2.reduce((s, x) => s + x, 0)} kcal; fill p50 ${fs2[Math.floor(fs2.length / 2)]} p95 ${fs2[Math.floor(fs2.length * 0.95)]} max ${fs2.at(-1)}`);
const entries = rows.filter(r => r.fill > 0).map(r => ({ date: r.date, calories: r.fill, evidence: {
  method: 'weight-derived-v1', factor: FACTOR, estimate: r.estimate, logged: r.logged, status: r.status, rmr: r.rmr, neat: r.neat,
  steps: r.steps, stepsImputed: r.stepsImputed, exercise: r.exercise, balance: r.balance, weightTrend: r.weightTrend,
  dexa: DEXA.date } }));
fs.writeFileSync(args.out, JSON.stringify({ generatedFor: { from: START, to: END, min: MIN, dexa: DEXA }, entries }, null, 1));
console.error(`plan: ${entries.length} entries -> ${args.out}`);
