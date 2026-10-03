/**
 * Routine history — pure rules (RQ-AUTO-05).
 *
 * One run per routine-started load: when, which routine, which screen, what
 * it asked for, and the outcome with a plain reason ("Living Room TV did not
 * turn on"). Plus flags for routines pointed at screens that are off,
 * unreachable, retired or unknown, or whose last start failed.
 *
 * @module domains/media/routineHistory
 */

export const ROUTINE_HISTORY_DEFAULTS = Object.freeze({
  max: 500,
  retentionDays: 30,
  // A browser not heard from for this long is "not open right now".
  browserReachableMs: 10 * 60 * 1000,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL_KEYS = ['play', 'queue', 'list', 'hymn', 'primary', 'scripture', 'talk', 'poem', 'open', 'app'];
const CONTENT_ID = /^[a-z][\w-]*:\S+$/i;

/** What a load asked for: the first content-bearing param. */
export function loadLabel(query) {
  const params = query || {};
  const key = LABEL_KEYS.find((k) => typeof params[k] === 'string' && params[k])
    ?? Object.keys(params).find((k) => !['shader', 'volume', 'shuffle', 'repeat', 'dispatchId', 'prewarmShuffle'].includes(k) && typeof params[k] === 'string');
  if (!key) return { key: null, value: null, contentId: null };
  const value = String(params[key]);
  return { key, value, contentId: CONTENT_ID.test(value) ? value : null };
}

function plainReason({ result, error, screenName, what }) {
  const screen = screenName || 'The screen';
  if (error) return `Something went wrong (${error.message ?? String(error)})`;
  if (!result) return 'No answer from the screen';
  if (result.deduplicated) return 'Already started a moment ago';
  if (result.ok) return null;
  if (result.cancelled) return 'Cancelled';
  if (result.error === 'Device not found') return `${screen} isn't set up`;
  switch (result.failedStep) {
    case 'power': return `${screen} did not turn on`;
    case 'verify': return `${screen} turned on but didn't come up`;
    case 'prepare': return `${screen} could not get ready`;
    case 'prewarm': return `Couldn't find ${what?.value ?? 'what it asked for'}`;
    case 'load': return `${screen} didn't respond — it may be asleep or closed`;
    case 'input': return `${screen} is missing its input device`;
    default: return result.error ? `Didn't start (${result.error})` : "Didn't start";
  }
}

/**
 * @param {{at:string, routine:{id:string|null, name:string|null}, deviceId:string, screenName?:string|null,
 *          query?:Object, result?:Object, error?:Error}} input
 */
export function buildRoutineRun({ at, routine, deviceId, screenName = null, query = {}, result = null, error = null }) {
  const what = loadLabel(query);
  const outcome = error || !result || (!result.ok && !result.deduplicated)
    ? 'failed'
    : (result.deduplicated ? 'deduplicated' : 'started');
  return {
    at,
    routine: { id: routine?.id ?? null, name: routine?.name ?? null },
    deviceId,
    what,
    outcome,
    reason: plainReason({ result, error, screenName, what }),
    failedStep: outcome === 'failed' ? (result?.failedStep ?? null) : null,
    elapsedMs: Number.isFinite(result?.totalElapsedMs) ? result.totalElapsedMs : null,
    dispatchId: result?.dispatchId ?? null,
  };
}

/** Append, drop runs past retention, keep the newest `max`. Oldest first. */
export function appendRun(runs, run, { now, max = ROUTINE_HISTORY_DEFAULTS.max, retentionDays = ROUTINE_HISTORY_DEFAULTS.retentionDays } = {}) {
  const cutoff = now - retentionDays * DAY_MS;
  const kept = (runs || []).filter((r) => {
    const t = Date.parse(r?.at);
    return !Number.isFinite(t) || t >= cutoff;
  });
  kept.push(run);
  return kept.slice(-max);
}

/**
 * Routines that will not (or did not) work as things stand.
 * @param {{routines: Array, screens: Array, retired?: Array, runs?: Array, now: number}} input
 *   screens: registry views (screens + notSeenLately), with `wakeable`, `online`, `lastSeen`, `aliases`
 * @returns {Array<{routine:{id,name}, deviceId, screenName, problem, severity:'warn'|'info', reason}>}
 */
export function flagRoutines({ routines = [], screens = [], retired = [], runs = [], now }) {
  const byId = new Map();
  for (const screen of screens) {
    byId.set(screen.id, { screen, retired: false });
    for (const alias of screen.aliases || []) byId.set(alias, { screen, retired: false });
  }
  for (const screen of retired) {
    byId.set(screen.id, { screen, retired: true });
    for (const alias of screen.aliases || []) byId.set(alias, { screen, retired: true });
  }
  const lastRun = new Map();
  for (const run of runs) {
    const key = `${run?.routine?.id ?? run?.routine?.name}|${run?.deviceId}`;
    const prev = lastRun.get(key);
    if (!prev || Date.parse(run.at) >= Date.parse(prev.at)) lastRun.set(key, run);
  }
  const flags = [];
  for (const routine of routines) {
    const seen = new Set();
    for (const target of routine.targets || []) {
      const hit = byId.get(target.deviceId);
      const deviceId = hit?.screen?.id ?? target.deviceId;
      if (seen.has(deviceId)) continue;
      seen.add(deviceId);
      const ref = { id: routine.id ?? null, name: routine.name ?? null };
      const flag = (problem, severity, reason) => flags.push({ routine: ref, deviceId, screenName: hit?.screen?.name ?? null, problem, severity, reason });
      if (!hit) { flag('unknown-screen', 'warn', `Points at a screen the house doesn't know (${target.deviceId})`); continue; }
      const { screen } = hit;
      if (hit.retired) { flag('retired', 'warn', `Points at ${screen.name}, which was retired`); continue; }
      const run = lastRun.get(`${routine.id ?? routine.name}|${deviceId}`)
        ?? (screen.aliases || []).map((a) => lastRun.get(`${routine.id ?? routine.name}|${a}`)).find(Boolean);
      if (run?.outcome === 'failed') { flag('last-start-failed', 'warn', run.reason || 'The last start failed'); continue; }
      if (screen.kind === 'browser') {
        const heard = Date.parse(screen.lastSeen);
        if (screen.online !== true && (!Number.isFinite(heard) || now - heard > ROUTINE_HISTORY_DEFAULTS.browserReachableMs)) {
          flag('unreachable', 'warn', `${screen.name} isn't open right now`);
        }
        continue;
      }
      if (screen.online === false) {
        if (screen.wakeable) flag('off', 'info', `${screen.name} is off; the routine will turn it on`);
        else flag('unreachable', 'warn', `${screen.name} isn't reachable`);
      }
    }
  }
  return flags;
}
