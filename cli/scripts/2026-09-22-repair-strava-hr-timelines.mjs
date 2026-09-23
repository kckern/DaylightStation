// One-shot repair, run inside the daylight-station container:
//   docker exec -i -e MODE=write daylight-station node --input-type=module - < repair.mjs
// 1. Rebuild compressed Strava-only session timelines from heartrate+time streams.
// 2. Sync Strava's current activity titles into session files, archives and summary.
import fs from 'fs';
import path from 'path';
const APP = '/usr/src/app';
const { loadYamlSafe, saveYaml } = await import(`${APP}/backend/src/0_system/utils/FileIO.mjs`);
const { encodeSingleSeries } = await import(`${APP}/backend/src/2_domains/fitness/services/TimelineService.mjs`);
const B = await import(`${APP}/backend/src/2_domains/fitness/services/StravaSessionBuilder.mjs`);

const WRITE = process.env.MODE === 'write';
const ONLY = process.env.ONLY || null;
const DATA = `${APP}/data`;
const LOG = `${DATA}/household/fitness/log`;
const USER = 'kckern';
const BACKUP = `${DATA}/_backups/2026-09-22-strava-hr-repair`;
const MAX_HOLD = 60;

const auth = loadYamlSafe(`${DATA}/users/${USER}/auth/strava`);
if (!auth?.access_token || auth.expires_at * 1000 < Date.now() + 10 * 60 * 1000) {
  console.error('access token missing or expiring within 10 min'); process.exit(1);
}
const api = async (p) => {
  const r = await fetch(`https://www.strava.com/api/v3${p}`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};
const backedUp = new Set();
const save = (file, data) => {
  if (!WRITE) return;
  if (!backedUp.has(file)) {
    const dest = path.join(BACKUP, path.relative(DATA, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    backedUp.add(file);
  }
  saveYaml(file, data);
};

// Same algorithm as the new StravaSessionBuilder.expandToPerSecond
function expand(hr, time) {
  const last = time[time.length - 1];
  const out = new Array(last + 1).fill(null);
  for (let i = 0; i < time.length; i++) {
    const next = i + 1 < time.length ? time[i + 1] : time[i] + 1;
    const until = next - time[i] <= MAX_HOLD ? next : time[i] + 1;
    for (let s = time[i]; s < until && s <= last; s++) out[s] = hr[i];
  }
  return out;
}
const enc = (a) => { const e = encodeSingleSeries(a); return typeof e === 'string' ? e : JSON.stringify(e); };
const activityIdOf = (d) => d?.strava?.activityId
  || Object.values(d?.participants || {}).find(p => p?.strava?.activityId)?.strava.activityId;

// ---- scan sessions ----
const sessions = [];
for (const date of fs.readdirSync(LOG).sort()) {
  const dir = path.join(LOG, date);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yml'))) {
    const file = path.join(dir, f);
    const d = loadYamlSafe(file);
    const id = activityIdOf(d);
    if (!id) continue;
    sessions.push({ file, date, d, id: String(id) });
  }
}
const affected = sessions.filter(s => s.d.session?.source === 'strava'
  && s.d.session?.duration_seconds > 0
  && (s.d.timeline?.tick_count || 0) * 5 < 0.9 * s.d.session.duration_seconds
  && (!ONLY || s.d.sessionId === ONLY));
console.log(`sessions with strava id: ${sessions.length}; compressed strava-only: ${affected.length}; mode=${WRITE ? 'WRITE' : 'DRY'}`);

// ---- current titles from the list endpoint ----
const names = new Map();
const earliest = Math.floor(new Date(`${sessions[0]?.date || '2010-01-01'}T00:00:00Z`).getTime() / 1000) - 86400;
for (let page = 1; page < 60; page++) {
  const list = await api(`/athlete/activities?after=${earliest}&per_page=200&page=${page}`);
  for (const a of list) names.set(String(a.id), a.name);
  if (list.length < 200) break;
}
console.log(`titles fetched: ${names.size}`);

// ---- archives + summary ----
const archDir = `${DATA}/users/${USER}/lifelog/strava`;
const archFiles = new Map();
for (const f of fs.readdirSync(archDir)) {
  const m = f.match(/_(\d+)\.yml$/); if (m) archFiles.set(m[1], path.join(archDir, f));
}
const summaryFile = `${DATA}/users/${USER}/lifelog/strava.yml`;
const summary = loadYamlSafe(summaryFile) || {};
let summaryDirty = false;
const setSummary = (id, patch) => {
  for (const list of Object.values(summary)) {
    if (!Array.isArray(list)) continue;
    const e = list.find(x => String(x.id) === id);
    if (!e) continue;
    for (const [k, v] of Object.entries(patch)) if (e[k] !== v) { e[k] = v; summaryDirty = true; }
  }
};

// ---- 1. timeline rebuild ----
const rebuilt = new Set();
for (const s of affected) {
  const { d } = s;
  const streams = await api(`/activities/${s.id}/streams?keys=heartrate,time&key_by_type=true`);
  const hr = streams.heartrate?.data, time = streams.time?.data;
  if (!hr || !time || hr.length !== time.length || hr.length < 2) { console.log(`SKIP ${d.sessionId} no usable streams`); continue; }
  const t = B.buildStravaSessionTimeline(expand(hr, time));
  const user = Object.keys(d.timeline.series || {}).find(k => k.endsWith(':hr'))?.split(':')[0]
    || Object.keys(d.participants || {})[0];
  const before = { ticks: d.timeline.tick_count, rings: d.treasureBox?.totalRings };
  if (t.hrSamples.length <= (before.ticks || 0)) { console.log(`SKIP ${d.sessionId} rebuild would shrink ${before.ticks}->${t.hrSamples.length} ticks (Strava HR covers ${time[time.length - 1]}s)`); continue; }
  d.timeline.series = {
    ...d.timeline.series,
    [`${user}:hr`]: enc(t.hrSamples),
    [`${user}:zone`]: enc(t.zoneSeries),
    [`${user}:rings`]: enc(t.ringsSeries),
    'global:rings': enc(t.ringsSeries),
  };
  d.timeline.tick_count = t.hrSamples.length;
  d.treasureBox = { ...(d.treasureBox || {}), ringTimeUnitMs: 5000, totalRings: t.totalRings, buckets: t.buckets };
  d.summary = d.summary || {};
  d.summary.participants = d.summary.participants || {};
  d.summary.participants[user] = {
    ...(d.summary.participants[user] || {}),
    rings: t.totalRings, hr_avg: t.hrStats.hrAvg, hr_max: t.hrStats.hrMax, hr_min: t.hrStats.hrMin,
    zone_minutes: t.zoneMinutes,
  };
  d.summary.rings = { total: t.totalRings, buckets: t.buckets };
  rebuilt.add(s.file);
  console.log(`REBUILD ${d.sessionId} dur=${d.session.duration_seconds}s ticks ${before.ticks}->${t.hrSamples.length} rings ${before.rings}->${t.totalRings} avg=${t.hrStats.hrAvg}`);

  const af = archFiles.get(s.id);
  if (af) {
    const a = loadYamlSafe(af);
    if (a?.data) { a.data.heartRateTimes = time; a.data.homeRings = t.totalRings; save(af, a); }
  }
  setSummary(s.id, { homeRings: t.totalRings });
  await new Promise(r => setTimeout(r, 300));
}

// ---- 2. title sync ----
let retitled = 0;
for (const s of sessions) {
  const name = names.get(s.id);
  const dirty = rebuilt.has(s.file);
  if (name && s.d.strava?.name && s.d.strava.name !== name && (!ONLY || s.d.sessionId === ONLY)) {
    console.log(`TITLE ${s.d.sessionId} "${s.d.strava.name}" -> "${name}"`);
    s.d.strava.name = name; retitled++;
    save(s.file, s.d);
  } else if (dirty) save(s.file, s.d);
}
for (const [id, name] of names) {
  if (ONLY) break;
  setSummary(id, { title: name });
  const af = archFiles.get(id);
  if (!af) continue;
  const a = loadYamlSafe(af);
  if (a?.data && a.data.name !== name) { a.data.name = name; save(af, a); }
}
if (summaryDirty) save(summaryFile, summary);
console.log(`done: rebuilt=${rebuilt.size} retitled=${retitled} summaryChanged=${summaryDirty} filesWritten=${backedUp.size}`);
