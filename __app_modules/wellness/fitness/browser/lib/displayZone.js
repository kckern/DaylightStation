import { deriveZoneProgressSnapshot } from "../hooks/fitness/types.js";

// THE zone a rider SEES: card colour, zone badge, progress bar, avatar ring and
// the Fire treatment all come from this one record, so they can never disagree
// with each other or with the BPM printed beside them.
//
// It is built from the heart rate on screen, on the ladder ZoneProfileStore
// validated for that rider (its committed ladder) — not from the committed
// zone. The committed zone carries the anti-flap rules (exit margin, upward
// confirmation, cooldown) and stays the authority for governance, challenges
// and TreasureBox; it lags the reading on purpose. Pairing a committed colour
// with a live progress bar is what showed an orange card with a "nearly at
// Hot" bar for a rider who had just slipped back into Warm (2026-11-13).
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
      const zoneId = String(snap.currentZoneId).toLowerCase();
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
