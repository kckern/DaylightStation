// Pure weekly-ring projection for the fitness home Momentum widget. No DOM and
// no fetch: the same persisted `participants[id].rings` value consumed by the
// backend fitness.rings provider is the authority here.

const CREDITED_ZONES = ['active', 'warm', 'hot', 'fire']; // cool earns no rings
const DEFAULT_COMPARE_WEEKS = 4;
const DEFAULT_BOUNDARY_HOUR = 4; // same study-day boundary as weekly measures
const DEFAULT_ZONE_RING_RATES = Object.freeze({ active: 1, warm: 2, hot: 3, fire: 5 });

const blankZones = () => ({ active: 0, warm: 0, hot: 0, fire: 0 });

/** Monday 04:00 local for the fitness week containing `now`. */
export function mondayWeekStart(now = Date.now(), boundaryHour = DEFAULT_BOUNDARY_HOUR) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return null;
  // Before the household's 04:00 day boundary it is still the previous study
  // day. Work from that calendar day, then anchor its containing Monday.
  if (at.getHours() < boundaryHour) at.setDate(at.getDate() - 1);
  const daysSinceMonday = (at.getDay() + 6) % 7;
  at.setDate(at.getDate() - daysSinceMonday);
  at.setHours(boundaryHour, 0, 0, 0);
  return at.getTime();
}

/** Shift a local week boundary without introducing a DST-sized drift. */
function shiftWeeks(startMs, count) {
  const at = new Date(startMs);
  at.setDate(at.getDate() + count * 7);
  return at.getTime();
}

function sessionStartMs(session) {
  const raw = session?.startTime ?? session?.start ?? null;
  if (raw == null) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the exact stored per-person total. Sessions written before that summary
 * field was surfaced can still be recovered when they have exactly one person,
 * because the session total then belongs unambiguously to that person.
 */
function participantRings(session, info) {
  const direct = info?.rings ?? info?.coins;
  if (direct != null && Number.isFinite(Number(direct))) return Math.max(0, Number(direct));
  if (Object.keys(session?.participants || {}).length !== 1) return 0;
  const total = session?.totalRings ?? session?.totalCoins ?? session?.rings;
  return total != null && Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
}

function normalizedRates(zoneRingRates) {
  return Object.fromEntries(CREDITED_ZONES.map((zone) => {
    const configured = Number(zoneRingRates?.[zone]);
    return [zone, Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_ZONE_RING_RATES[zone]];
  }));
}

/**
 * Add exact rings plus their colored contribution to a bucket. Session
 * summaries keep exact total rings and zone minutes, but not per-zone rings.
 * Weighting the minutes by the configured award rate preserves the exact total
 * while making the green/yellow/orange/red bands describe ring contribution.
 */
function addSession(bucket, session, info, rates) {
  const rings = participantRings(session, info);
  bucket.rings += rings;
  if (rings <= 0) return;

  const zoneMinutes = info?.zoneMinutes ?? info?.zone_minutes;
  if (!zoneMinutes || typeof zoneMinutes !== 'object') {
    bucket.zones.active += rings;
    return;
  }

  const weights = CREDITED_ZONES.map((zone) => ({
    zone,
    value: Math.max(0, Number(zoneMinutes[zone]) || 0) * rates[zone],
  }));
  const totalWeight = weights.reduce((sum, row) => sum + row.value, 0);
  if (totalWeight <= 0) {
    bucket.zones.active += rings;
    return;
  }
  for (const { zone, value } of weights) bucket.zones[zone] += rings * (value / totalWeight);
}

function finalizeWeek(bucket, current, startMs) {
  return {
    rings: Math.round(bucket.rings),
    zones: { ...bucket.zones },
    current,
    startMs,
  };
}

/**
 * @param {Array} sessions - summaries containing participants[id].rings + zoneMinutes
 * @param {Array} roster   - [{ id, name, avatarId }] in display order
 * @param {object} [opts]
 * @param {number} [opts.now=Date.now()] - clock anchor
 * @param {number} [opts.compareWeeks=4] - Monday-aligned bars, oldest to current
 * @param {number} [opts.boundaryHour=4] - household study-day boundary
 * @param {object} [opts.zoneRingRates]  - ring award rate by zone id
 * @param {string} [opts.householdLabel]
 * @returns {{ household: object, members: object[] }}
 */
export function computeMomentum(sessions, roster, opts = {}) {
  const now = Number(opts.now ?? Date.now());
  const compareWeeks = Math.max(1, opts.compareWeeks ?? DEFAULT_COMPARE_WEEKS);
  const householdLabel = opts.householdLabel || 'Your household';
  const list = Array.isArray(sessions) ? sessions : [];
  const members = Array.isArray(roster) ? roster : [];
  const rates = normalizedRates(opts.zoneRingRates);
  const currentStart = mondayWeekStart(now, opts.boundaryHour ?? DEFAULT_BOUNDARY_HOUR);
  const starts = Array.from(
    { length: compareWeeks },
    (_, i) => shiftWeeks(currentStart, i - (compareWeeks - 1)),
  );
  const nextStart = shiftWeeks(currentStart, 1);

  // id -> Monday-aligned buckets, oldest first.
  const bucketsByUser = new Map();
  const emptyBuckets = () => Array.from(
    { length: compareWeeks },
    () => ({ rings: 0, zones: blankZones() }),
  );

  for (const session of list) {
    const startedAt = sessionStartMs(session);
    if (!Number.isFinite(startedAt) || startedAt > now || startedAt < starts[0] || startedAt >= nextStart) continue;
    const idx = starts.findIndex((start, i) => (
      startedAt >= start && startedAt < (starts[i + 1] ?? nextStart)
    ));
    if (idx < 0) continue;
    for (const [uid, info] of Object.entries(session.participants || {})) {
      if (!bucketsByUser.has(uid)) bucketsByUser.set(uid, emptyBuckets());
      addSession(bucketsByUser.get(uid)[idx], session, info, rates);
    }
  }

  const memberRows = members.map((member) => {
    const buckets = bucketsByUser.get(member.id) || emptyBuckets();
    const weeks = buckets.map((bucket, i) => finalizeWeek(
      bucket,
      i === compareWeeks - 1,
      starts[i],
    ));
    return {
      id: member.id,
      name: member.name || member.id,
      avatarId: member.avatarId || member.id,
      weeks,
      rings: weeks[weeks.length - 1].rings,
    };
  });

  const householdWeeks = starts.map((startMs, i) => ({
    rings: 0,
    zones: blankZones(),
    current: i === compareWeeks - 1,
    startMs,
  }));
  for (const row of memberRows) {
    row.weeks.forEach((week, i) => {
      householdWeeks[i].rings += week.rings;
      for (const zone of CREDITED_ZONES) householdWeeks[i].zones[zone] += week.zones[zone];
    });
  }

  return {
    household: {
      label: householdLabel,
      compareWeeks,
      weeks: householdWeeks,
      rings: householdWeeks[householdWeeks.length - 1].rings,
      weekStartMs: currentStart,
    },
    members: memberRows,
  };
}
