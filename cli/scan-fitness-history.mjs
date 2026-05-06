#!/usr/bin/env node
/**
 * Read-only diagnostic scanner for fitness history data.
 *
 * Identifies four kinds of broken state caused by the resume-check / Strava-match
 * regressions documented in:
 *   docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md
 *
 * 1. SAME-DAY SAME-CONTENT FRAGMENTS — adjacent sessions with identical
 *    summary.media[*].contentId (primary), gap < 30min, neither finalized.
 *    These should have auto-merged but didn't.
 *
 * 2. STRAVA WEBHOOK BAD MATCHES — webhook jobs whose matchedSessionId points
 *    at a session that mismatches the activity (Run+GPS bound to a
 *    no-media zero-distance session).
 *
 * 3. ORPHAN STRAVA ACTIVITIES — webhook jobs with status != 'completed' that
 *    have no matching session, age > 7 days. (Should have created Strava-only
 *    sessions long ago.)
 *
 * 4. STUCK WEBHOOK JOBS — jobs with attempts > 10 (the new MAX_TOTAL_ATTEMPTS
 *    cap from Task 3.1). Should be abandoned.
 *
 * Usage:
 *   node cli/scan-fitness-history.mjs              (read-only diagnostic)
 *   node cli/scan-fitness-history.mjs --auto-fix   (delete absorbable slivers)
 *
 * Reads from /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data
 * (Dropbox mirror of prod).
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

const DATA_BASE = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';
const HISTORY_DIR = path.join(DATA_BASE, 'household/history/fitness');
const WEBHOOK_JOBS_DIR = path.join(DATA_BASE, 'household/common/strava/strava-webhooks');

const MAX_GAP_MS = 30 * 60 * 1000;       // resume window
const MAX_TOTAL_ATTEMPTS = 10;
const ORPHAN_AGE_DAYS = 7;

const args = process.argv.slice(2);
const AUTO_FIX = args.includes('--auto-fix');

const loadYaml = (p) => {
  try { return yaml.load(readFileSync(p, 'utf8')); }
  catch { return null; }
};

// ---------------------------------------------------------------------------
// Pass 1: walk all session date dirs, collect normalized session metadata
// ---------------------------------------------------------------------------
function loadAllSessions() {
  const sessions = [];
  if (!existsSync(HISTORY_DIR)) return sessions;
  const dates = readdirSync(HISTORY_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  for (const date of dates) {
    const dateDir = path.join(HISTORY_DIR, date);
    const files = readdirSync(dateDir).filter(f => f.endsWith('.yml'));
    for (const file of files) {
      const fullPath = path.join(dateDir, file);
      const data = loadYaml(fullPath);
      if (!data) continue;
      const sessionId = data.sessionId || data.session?.id || file.replace(/\.yml$/, '');
      const start = data.session?.start;
      const end = data.session?.end;
      const tz = data.timezone || 'America/Los_Angeles';
      const startMs = start ? new Date(`${start.replace(' ', 'T')}${tz === 'America/Los_Angeles' ? '-07:00' : ''}`).getTime() : null;
      const endMs = end ? new Date(`${end.replace(' ', 'T')}${tz === 'America/Los_Angeles' ? '-07:00' : ''}`).getTime() : null;
      const primary = (data.summary?.media || []).find(m => m && m.primary);
      // Strava metadata can live in two places: top-level `strava:` block (set
      // by _createStravaOnlySession) OR per-participant `participants.{p}.strava`
      // (set by the enrichment writeback path). Check both.
      const participantStrava = Object.values(data.participants || {})
        .map(p => p?.strava).find(s => s && s.activityId);
      sessions.push({
        sessionId, file, fullPath, date,
        start, end, startMs, endMs,
        durationSec: data.session?.duration_seconds || 0,
        finalized: !!data.finalized,
        primaryContentId: primary?.contentId || null,
        primaryTitle: primary?.title || null,
        hasMedia: Array.isArray(data.summary?.media) && data.summary.media.length > 0,
        stravaActivityId: data.strava?.activityId || participantStrava?.activityId || null,
        stravaName: data.strava?.name || null,
        stravaType: data.strava?.type || participantStrava?.type || null,
        stravaDistance: data.strava?.distance || 0,
        stravaSource: data.strava?.activityId ? 'top-level' : (participantStrava?.activityId ? 'participant' : null),
        source: data.session?.source || null,
        coins: data.summary?.coins?.total ?? 0,
      });
    }
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// Pass 2: walk webhook jobs
// ---------------------------------------------------------------------------
function loadAllJobs() {
  if (!existsSync(WEBHOOK_JOBS_DIR)) return [];
  const files = readdirSync(WEBHOOK_JOBS_DIR).filter(f => f.endsWith('.yml'));
  return files.map(f => {
    const fullPath = path.join(WEBHOOK_JOBS_DIR, f);
    const data = loadYaml(fullPath);
    if (!data) return null;
    return { ...data, _file: f, _fullPath: fullPath };
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Detector 1: same-day same-content fragments
// ---------------------------------------------------------------------------
function findFragments(sessions) {
  const byDate = {};
  for (const s of sessions) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }
  const fragments = [];
  for (const [date, list] of Object.entries(byDate)) {
    list.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    let groupStart = 0;
    while (groupStart < list.length) {
      const group = [list[groupStart]];
      for (let i = groupStart + 1; i < list.length; i++) {
        const prev = group[group.length - 1];
        const curr = list[i];
        if (!prev.endMs || !curr.startMs) break;
        const gap = curr.startMs - prev.endMs;
        const sameContent = prev.primaryContentId
          && curr.primaryContentId
          && prev.primaryContentId === curr.primaryContentId;
        if (gap >= 0 && gap < MAX_GAP_MS && sameContent
            && !prev.finalized && !curr.finalized) {
          group.push(curr);
        } else {
          break;
        }
      }
      if (group.length > 1) {
        fragments.push({
          date,
          sessionIds: group.map(g => g.sessionId),
          contentId: group[0].primaryContentId,
          title: group[0].primaryTitle,
          totalDurationSec: group.reduce((a, g) => a + g.durationSec, 0),
          gaps: group.slice(1).map((g, i) =>
            g.startMs - group[i].endMs).map(ms => Math.round(ms/1000) + 's'),
        });
      }
      groupStart += group.length;
    }
  }
  return fragments;
}

// ---------------------------------------------------------------------------
// Detector 2: webhook bad matches (Run+GPS bound to no-media zero-dist)
// ---------------------------------------------------------------------------
function findBadMatches(jobs, sessions) {
  const badMatches = [];
  const sessionById = Object.fromEntries(sessions.map(s => [s.sessionId, s]));
  for (const job of jobs) {
    if (job.status !== 'completed' || !job.matchedSessionId) continue;
    const session = sessionById[job.matchedSessionId];
    if (!session) {
      badMatches.push({
        kind: 'missing-session',
        jobFile: job._file,
        activityId: job.activityId,
        matchedSessionId: job.matchedSessionId,
      });
      continue;
    }
    // The bug pattern: a GPS Run/Ride was matched to a non-Strava-only home
    // session that has no media and is short. The strava data is only in
    // `participants.{*}.strava` (enrichment writeback path) — there is no
    // top-level `strava:` block (which would indicate _createStravaOnlySession
    // ran). The signature:
    //   - session.stravaType ∈ {Run, Ride}
    //   - session.source !== 'strava' (not a Strava-only session)
    //   - session.stravaSource === 'participant' (only writeback-enriched)
    //   - session has no media
    //   - session is short (<15 min)
    //   - low coins (<50, indicating no real workout)
    if (
      (session.stravaType === 'Run' || session.stravaType === 'Ride')
      && session.source !== 'strava'
      && session.stravaSource === 'participant'
      && !session.hasMedia
      && session.durationSec > 0
      && session.durationSec < 900
      && (session.coins || 0) < 100
    ) {
      badMatches.push({
        kind: 'gps-vs-empty-short-session',
        jobFile: job._file,
        activityId: job.activityId,
        matchedSessionId: job.matchedSessionId,
        date: session.date,
        sessionDurationMin: Math.round(session.durationSec / 60),
        stravaType: session.stravaType,
        coins: session.coins,
      });
    }
  }
  return badMatches;
}

// ---------------------------------------------------------------------------
// Detector 3: orphan Strava activities (jobs unmatched, > N days old)
// ---------------------------------------------------------------------------
function findOrphans(jobs) {
  const cutoff = Date.now() - ORPHAN_AGE_DAYS * 86400 * 1000;
  return jobs.filter(j =>
    (j.status === 'unmatched' || j.status === 'pending')
    && j.receivedAt
    && new Date(j.receivedAt).getTime() < cutoff
  ).map(j => ({
    jobFile: j._file,
    activityId: j.activityId,
    status: j.status,
    attempts: j.attempts || 0,
    receivedAt: j.receivedAt,
    ageDays: Math.floor((Date.now() - new Date(j.receivedAt).getTime()) / 86400000),
  }));
}

// ---------------------------------------------------------------------------
// Detector 4: stuck jobs (attempts >= MAX_TOTAL_ATTEMPTS)
// ---------------------------------------------------------------------------
function findStuckJobs(jobs) {
  return jobs.filter(j => (j.attempts || 0) >= MAX_TOTAL_ATTEMPTS && j.status !== 'completed' && j.status !== 'abandoned')
    .map(j => ({
      jobFile: j._file,
      activityId: j.activityId,
      status: j.status,
      attempts: j.attempts,
      receivedAt: j.receivedAt,
      lastAttemptAt: j.lastAttemptAt,
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const sessions = loadAllSessions();
const jobs = loadAllJobs();

console.log(`Scanned ${sessions.length} sessions across ${new Set(sessions.map(s=>s.date)).size} dates`);
console.log(`Scanned ${jobs.length} webhook job files\n`);

const fragments = findFragments(sessions);
const badMatches = findBadMatches(jobs, sessions);
const orphans = findOrphans(jobs);
const stuck = findStuckJobs(jobs);

console.log(`=== 1. FRAGMENTS (same-day same-content, gap<30min) — ${fragments.length} groups ===`);
for (const f of fragments) {
  console.log(`  ${f.date} | ${f.contentId.padEnd(20)} | ${(f.title||'').slice(0,40).padEnd(40)} | ${f.sessionIds.join(', ')} | gaps: ${f.gaps.join(',')}`);
}

console.log(`\n=== 2. STRAVA BAD MATCHES — ${badMatches.length} ===`);
for (const b of badMatches) {
  if (b.kind === 'missing-session') {
    console.log(`  [missing-session]    activity=${b.activityId} | session=${b.matchedSessionId} (file not found on disk)`);
  } else {
    console.log(`  [gps-vs-empty-short] ${b.date} | activity=${b.activityId} | session=${b.matchedSessionId} | ${b.stravaType} | ${b.sessionDurationMin}min, ${b.coins} coins`);
  }
}

console.log(`\n=== 3. ORPHAN STRAVA JOBS (unmatched/pending, age > ${ORPHAN_AGE_DAYS}d) — ${orphans.length} ===`);
for (const o of orphans) {
  console.log(`  ${o.activityId} | ${o.status} | ${o.attempts} attempts | ${o.ageDays}d old | ${o.receivedAt}`);
}

console.log(`\n=== 4. STUCK JOBS (attempts >= ${MAX_TOTAL_ATTEMPTS}) — ${stuck.length} ===`);
for (const s of stuck) {
  console.log(`  ${s.activityId} | ${s.status} | ${s.attempts} attempts | last: ${s.lastAttemptAt}`);
}

if (AUTO_FIX) {
  console.log('\n=== AUTO-FIX: running sliver absorption for each Strava-only session ===');
  const { absorbOverlappingSlivers } = await import(
    path.join(PROJECT_ROOT, 'backend/src/3_applications/fitness/sliverAbsorption.mjs')
  );

  const stravaOnlySessions = sessions.filter(s => s.source === 'strava');
  let totalAbsorbed = 0;

  for (const s of stravaOnlySessions) {
    const dateDir = path.join(HISTORY_DIR, s.date);
    if (!s.stravaActivityId) continue;
    // The scanner doesn't fetch from the Strava API; reconstruct the minimal
    // fields the helper needs from the session's stored data.
    const activityShim = {
      id: s.stravaActivityId,
      start_date: new Date(s.startMs).toISOString(),
      elapsed_time: Math.round((s.endMs - s.startMs) / 1000),
      moving_time: Math.round((s.endMs - s.startMs) / 1000),
    };
    const result = absorbOverlappingSlivers(activityShim, dateDir, {
      justCreatedSessionId: s.sessionId,
      tz: 'America/Los_Angeles',
      logger: console,
    });
    if (result.absorbed.length > 0) {
      console.log(`  ${s.date}: absorbed ${result.absorbed.length} sliver(s) for ${s.stravaName || s.stravaActivityId}`);
      totalAbsorbed += result.absorbed.length;
    }
  }

  console.log(`\nAUTO-FIX complete: ${totalAbsorbed} slivers absorbed across ${stravaOnlySessions.length} Strava-only sessions.`);
}
