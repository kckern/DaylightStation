// frontend/src/modules/Fitness/widgets/FitnessMomentum/momentum.js
//
// Pure momentum computation for the fitness home Momentum widget. No DOM, no
// fetch — a function of (sessions, roster, opts).
//
// "Effort" is HR-zone-weighted: only minutes in active/warm/hot/fire count;
// COOL gets no credit and is omitted. For each person we bucket effort into the
// last `compareWeeks` consecutive windows (default 4 × 7 days), oldest → newest,
// so the UI can draw same-scale weekly bars and read "how does this week stack
// up against the past few weeks." The window length (default 7 days) and the
// number of compared weeks are caller-configurable.

const DAY_MS = 86_400_000;
const CREDITED_ZONES = ['active', 'warm', 'hot', 'fire']; // cool omitted — no credit
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_COMPARE_WEEKS = 4;

/** Shift a 'YYYY-MM-DD' day string by `delta` days (UTC-safe date arithmetic). */
export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

const blankZones = () => ({ active: 0, warm: 0, hot: 0, fire: 0 });

/** Add a participant's credited zone minutes into an accumulator bucket. */
function addCredited(bucket, zoneMinutes, fallbackMin) {
  if (zoneMinutes && typeof zoneMinutes === 'object') {
    for (const z of CREDITED_ZONES) bucket.zones[z] += Number(zoneMinutes[z]) || 0;
  } else {
    // No breakdown — attribute the whole duration to 'active' so it still shows.
    bucket.zones.active += fallbackMin;
  }
}

/** Round a zones accumulator and total it into a { effortMinutes, zones } week. */
function finalizeWeek(bucket, current) {
  const zones = {
    active: Math.round(bucket.zones.active),
    warm: Math.round(bucket.zones.warm),
    hot: Math.round(bucket.zones.hot),
    fire: Math.round(bucket.zones.fire),
  };
  return { effortMinutes: zones.active + zones.warm + zones.hot + zones.fire, zones, current };
}

/**
 * @param {Array} sessions - fitness sessions ({ startTime, durationMs, participants: { id: { zoneMinutes } } })
 * @param {Array} roster   - [{ id, name, avatarId }] family members (display order preserved)
 * @param {object} [opts]
 * @param {number} [opts.now=Date.now()]    - rolling-window anchor (epoch ms)
 * @param {number} [opts.windowDays=7]      - measurement window length in days
 * @param {number} [opts.compareWeeks=4]    - how many consecutive windows to bucket (bars per person)
 * @param {string} [opts.householdLabel]    - team headline label
 * @returns {{ household: object, members: object[] }}
 */
export function computeMomentum(sessions, roster, opts = {}) {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const compareWeeks = Math.max(1, opts.compareWeeks ?? DEFAULT_COMPARE_WEEKS);
  const householdLabel = opts.householdLabel || 'Your household';
  const list = Array.isArray(sessions) ? sessions : [];
  const members = Array.isArray(roster) ? roster : [];

  const windowMs = windowDays * DAY_MS;
  const spanStart = now - compareWeeks * windowMs;

  // id -> array of `compareWeeks` zone accumulators, oldest (index 0) → newest (last).
  const bucketsByUser = new Map();
  const emptyBuckets = () => Array.from({ length: compareWeeks }, () => ({ zones: blankZones() }));

  for (const s of list) {
    const t = s.startTime ?? 0;
    if (t < spanStart || t > now) continue;
    const fromNewest = Math.floor((now - t) / windowMs); // 0 = current window
    if (fromNewest < 0 || fromNewest >= compareWeeks) continue;
    const idx = (compareWeeks - 1) - fromNewest; // oldest-first array index
    const fallbackMin = (s.durationMs || 0) / 60000;
    for (const [uid, info] of Object.entries(s.participants || {})) {
      if (!bucketsByUser.has(uid)) bucketsByUser.set(uid, emptyBuckets());
      addCredited(bucketsByUser.get(uid)[idx], info && info.zoneMinutes, fallbackMin);
    }
  }

  const memberRows = members.map((m) => {
    const buckets = bucketsByUser.get(m.id) || emptyBuckets();
    const weeks = buckets.map((b, i) => finalizeWeek(b, i === compareWeeks - 1));
    return {
      id: m.id,
      name: m.name || m.id,
      avatarId: m.avatarId || m.id,
      weeks,
      effortMinutes: weeks[weeks.length - 1].effortMinutes, // current week
    };
  });

  // Household: sum each member's weekly buckets position-by-position.
  const hWeeks = Array.from({ length: compareWeeks }, (_, i) => ({
    effortMinutes: 0,
    zones: blankZones(),
    current: i === compareWeeks - 1,
  }));
  for (const r of memberRows) {
    r.weeks.forEach((w, i) => {
      hWeeks[i].effortMinutes += w.effortMinutes;
      hWeeks[i].zones.active += w.zones.active;
      hWeeks[i].zones.warm += w.zones.warm;
      hWeeks[i].zones.hot += w.zones.hot;
      hWeeks[i].zones.fire += w.zones.fire;
    });
  }
  const household = {
    label: householdLabel,
    windowDays,
    compareWeeks,
    weeks: hWeeks,
    effortMinutes: hWeeks[hWeeks.length - 1].effortMinutes, // current week
  };

  return { household, members: memberRows };
}
