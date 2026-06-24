// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js
//
// Pure momentum computation for the fitness home Momentum widget. No DOM, no
// fetch — a function of (sessions, roster, opts).
//
// "Effort" is HR-zone-weighted: only minutes in active/warm/hot/fire count;
// COOL gets no credit and is omitted. The denominator is each person's own
// recent norm — their average effort over the prior `baselineWindows` windows
// (default 4) — NOT a fixed goal. So the bar reads "this week vs. your typical
// recent week." The window length (default 7 days) is caller-configurable.

const DAY_MS = 86_400_000;
const CREDITED_ZONES = ['active', 'warm', 'hot', 'fire']; // cool omitted — no credit
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_BASELINE_WINDOWS = 4;

/** Shift a 'YYYY-MM-DD' day string by `delta` days (UTC-safe date arithmetic). */
export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

const blankZones = () => ({ active: 0, warm: 0, hot: 0, fire: 0 });

/**
 * Total credited (cool-omitted) minutes for a participant entry. When the
 * per-zone breakdown is missing (older sessions predating zone_minutes), fall
 * back to the raw session minutes — we can't omit cool without the breakdown.
 */
function creditedMinutes(zoneMinutes, fallbackMin) {
  if (zoneMinutes && typeof zoneMinutes === 'object') {
    let sum = 0;
    for (const z of CREDITED_ZONES) sum += Number(zoneMinutes[z]) || 0;
    return sum;
  }
  return fallbackMin;
}

/**
 * @param {Array} sessions - fitness sessions ({ startTime, durationMs, participants: { id: { zoneMinutes } } })
 * @param {Array} roster   - [{ id, name, avatarId }] family members (display order preserved)
 * @param {object} [opts]
 * @param {number} [opts.now=Date.now()]            - rolling-window anchor (epoch ms)
 * @param {number} [opts.windowDays=7]              - measurement window length in days
 * @param {number} [opts.baselineWindows=4]         - how many prior windows form the comparison baseline
 * @param {string} [opts.householdLabel]            - team headline label
 * @returns {{ household: object, members: object[] }}
 */
export function computeMomentum(sessions, roster, opts = {}) {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const baselineWindows = opts.baselineWindows ?? DEFAULT_BASELINE_WINDOWS;
  const householdLabel = opts.householdLabel || 'Your household';
  const list = Array.isArray(sessions) ? sessions : [];
  const members = Array.isArray(roster) ? roster : [];

  const windowMs = windowDays * DAY_MS;
  const curStart = now - windowMs;                            // current window [curStart, now]
  const baseStart = now - windowMs * (baselineWindows + 1);   // baseline span  [baseStart, curStart)

  const curZones = new Map();   // id -> { active, warm, hot, fire } minutes this window
  const baseEffort = new Map(); // id -> total credited minutes across the baseline span

  for (const s of list) {
    const t = s.startTime ?? 0;
    const inCur = t >= curStart && t <= now;
    const inBase = t >= baseStart && t < curStart;
    if (!inCur && !inBase) continue;
    const fallbackMin = (s.durationMs || 0) / 60000;
    for (const [uid, info] of Object.entries(s.participants || {})) {
      const zm = info && info.zoneMinutes;
      if (inCur) {
        if (!curZones.has(uid)) curZones.set(uid, blankZones());
        const acc = curZones.get(uid);
        if (zm && typeof zm === 'object') {
          for (const z of CREDITED_ZONES) acc[z] += Number(zm[z]) || 0;
        } else {
          // No breakdown — attribute the whole duration to 'active' so it still shows.
          acc.active += fallbackMin;
        }
      }
      if (inBase) baseEffort.set(uid, (baseEffort.get(uid) || 0) + creditedMinutes(zm, fallbackMin));
    }
  }

  const memberRows = members.map((m) => {
    const z = curZones.get(m.id) || blankZones();
    const zones = {
      active: Math.round(z.active),
      warm: Math.round(z.warm),
      hot: Math.round(z.hot),
      fire: Math.round(z.fire),
    };
    const effortMinutes = Math.round(z.active + z.warm + z.hot + z.fire);
    const baselineMinutes = Math.round((baseEffort.get(m.id) || 0) / baselineWindows);
    const pct = baselineMinutes > 0 ? effortMinutes / baselineMinutes : (effortMinutes > 0 ? 1 : 0);
    return {
      id: m.id,
      name: m.name || m.id,
      avatarId: m.avatarId || m.id,
      zones,
      effortMinutes,
      baselineMinutes,
      pct,
      ratioPct: Math.round(pct * 100),
      ahead: baselineMinutes > 0 ? effortMinutes >= baselineMinutes : effortMinutes > 0,
    };
  });

  const hZones = blankZones();
  let hEffort = 0;
  let hBaseline = 0;
  for (const r of memberRows) {
    hZones.active += r.zones.active;
    hZones.warm += r.zones.warm;
    hZones.hot += r.zones.hot;
    hZones.fire += r.zones.fire;
    hEffort += r.effortMinutes;
    hBaseline += r.baselineMinutes;
  }
  const hPct = hBaseline > 0 ? hEffort / hBaseline : (hEffort > 0 ? 1 : 0);
  const household = {
    label: householdLabel,
    windowDays,
    zones: hZones,
    effortMinutes: hEffort,
    baselineMinutes: hBaseline,
    pct: hPct,
    ratioPct: Math.round(hPct * 100),
    ahead: hBaseline > 0 ? hEffort >= hBaseline : hEffort > 0,
  };

  return { household, members: memberRows };
}
