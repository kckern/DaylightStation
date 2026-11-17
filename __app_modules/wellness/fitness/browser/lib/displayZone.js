import { deriveZoneProgressSnapshot } from "../hooks/fitness/types.js";

// THE zone a rider SEES: card colour, zone badge, progress bar, avatar ring and
// the Fire treatment all come from this one record, so they can never disagree
// with each other.
//
// The ZONE is the committed one — the zone ZoneProfileStore settled on with its
// anti-flap rules (upward confirmation, Fire held 5s, exit margin, cooldown).
// The garage LEDs, governance and the Fire ceremony follow the same commit, so
// the ring turns red exactly when the room does, and a rider hovering on a line
// does not flip colour (and lap the ring) on every packet. Owner, 2026-11-17:
// "a little bit of stickiness".
//
// The BAR is live: the heart rate on screen, measured on that zone's band of
// the ladder ZoneProfileStore validated for the rider. A reading past the band
// pins it — full while a climb waits to be confirmed, empty while a drop is
// held by the exit margin. (Measuring a live zone's bar under a committed colour
// is what showed an orange card with a "nearly at Hot" bar for a rider back in
// Warm, 2026-11-13.)
//
// No committed zone on the ladder (nothing settled yet) → the zone the BPM is
// in, as before.
//
// No live reading (a strap gap inside the HR-loss grace) → the committed zone
// the store is holding, with no bar: there is no number to measure progress
// from, and the rider has not been shown to leave the zone.
//
// @param {Object} args
// @param {number|null} args.heartRate - the BPM the surface displays
// @param {Array|null} args.ladder - the rider's validated ladder
//   (ZoneProfileStore.getDisplayLadder); falls back to `fallbackLadder`
// @param {Array|null} [args.fallbackLadder] - household/base ladder, used only
//   while the store has no validated ladder for this rider
// @param {string|null} [args.committedZoneId]
// @param {string|null} [args.committedZoneColor]
// @param {string|null} [args.committedZoneName]
// @returns {{ zoneId: string|null, zoneName: string|null, zoneColor: string|null,
//   progress: number|null, showBar: boolean, max: boolean, live: boolean }}
export function displayZoneRecord({
  heartRate = null,
  ladder = null,
  fallbackLadder = null,
  committedZoneId = null,
  committedZoneColor = null,
  committedZoneName = null,
} = {}) {
  const zones = Array.isArray(ladder) && ladder.length ? ladder
    : (Array.isArray(fallbackLadder) && fallbackLadder.length ? fallbackLadder : null);
  // Read the BPM as printed (rounded): 124.6 shows "125" and must read as
  // having reached a 125 floor.
  const bpm = Number.isFinite(heartRate) && heartRate > 0 ? Math.round(heartRate) : null;
  if (bpm && zones) {
    const snap = deriveZoneProgressSnapshot({ zoneConfig: zones, heartRate: bpm });
    if (snap?.currentZoneId) {
      const liveId = String(snap.currentZoneId).toLowerCase();
      const sequence = Array.isArray(snap.zoneSequence) ? snap.zoneSequence : [];
      const rankOf = (id) => sequence.findIndex((z) => String(z?.id || '').toLowerCase() === id);
      const held = committedZoneId ? String(committedZoneId).toLowerCase() : null;
      const heldRank = held ? rankOf(held) : -1;
      const liveRank = rankOf(liveId);
      if (heldRank >= 0 && liveRank >= 0 && heldRank !== liveRank) {
        const zone = sequence[heldRank];
        const max = held === 'fire';
        return {
          zoneId: held,
          zoneName: zone?.name || committedZoneName || held,
          zoneColor: zone?.color || committedZoneColor || null,
          progress: max || liveRank > heldRank ? 1 : 0,
          showBar: true,
          max,
          live: true,
        };
      }
      const zoneId = liveId;
      const max = zoneId === 'fire';
      return {
        zoneId,
        zoneName: snap.currentZoneName || zoneId,
        zoneColor: snap.currentZoneColor || null,
        progress: max ? 1 : (Number.isFinite(snap.progress) ? snap.progress : null),
        showBar: max || Boolean(snap.showBar),
        max,
        live: true,
      };
    }
  }
  const held = committedZoneId ? String(committedZoneId).toLowerCase() : null;
  const max = held === 'fire';
  return {
    zoneId: held,
    zoneName: held ? (committedZoneName || held) : null,
    zoneColor: held ? (committedZoneColor || null) : null,
    // Fire has no next zone, so its full bar needs no reading to measure.
    progress: max ? 1 : null,
    showBar: max,
    max,
    live: false,
  };
}
