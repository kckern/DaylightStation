// Records are ordered by authority. An explicit null or untrusted state is
// meaningful: never revive it from a lower-priority record or a raw HR zone.
export function committedZoneId(...records) {
  for (const record of records) {
    if (!record) continue;
    if (record.zoneTrusted === false) return null;
    const key = Object.hasOwn(record, 'currentZoneId') ? 'currentZoneId'
      : Object.hasOwn(record, 'zoneId') ? 'zoneId' : null;
    if (key) return record[key] ? String(record[key]).toLowerCase() : null;
  }
  return null;
}

// The zone a rider CARD shows (and the sidebar groups by). The committed, earned
// zone when there is one; otherwise, while a live reading is present, the zone
// that reading sits in on the same ladder the store reads — its raw/display
// zone — so a card never says "No Zone" beside a heart rate (owner, 2026-11-10:
// a rider at 132 bpm read NO ZONE until the store had sustained readings).
// Presentation only: governance, TreasureBox and the roster's zoneMap keep
// using committedZoneId.
export function shownZoneId({ committed = null, heartRate = null, liveZoneId = null } = {}) {
  if (committed) return String(committed).toLowerCase();
  if (!(Number.isFinite(heartRate) && heartRate > 0)) return null;
  return liveZoneId ? String(liveZoneId).toLowerCase() : null;
}

// The earned zone a vitals entry publishes, from a ZoneProfileStore zone state.
// No state (startup-discarded packets) and untrusted state both earn nothing.
export function earnedZoneFields(zoneState) {
  const zoneTrusted = zoneState?.zoneTrusted === true;
  const earned = zoneTrusted ? zoneState : null;
  return {
    zoneId: earned?.zoneId ? String(earned.zoneId).toLowerCase() : null,
    zoneName: earned?.zoneName || null,
    zoneColor: earned?.zoneColor || null,
    zoneTrusted,
  };
}
