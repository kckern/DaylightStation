/**
 * Builds zone metadata from zone config. Single source for zone system info.
 * Produces map (display), rankMap (evaluation), infoMap (evaluation), ranked (sorted list).
 *
 * @param {Array} zoneConfig - Zone configuration array
 * @returns {{ map, rankMap, infoMap, ranked }}
 */
export function buildZoneMetadata(zoneConfig) {
  const zones = Array.isArray(zoneConfig) ? zoneConfig.filter(Boolean) : [];
  const sorted = [...zones].sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));

  const map = {};      // zoneId → { id, name, color, min, rank } — for display
  const rankMap = {};   // zoneId → rank integer — for GovernanceEngine
  const infoMap = {};   // zoneId → { id, name, color } — for GovernanceEngine
  const ranked = [];    // sorted array

  sorted.forEach((zone, index) => {
    if (!zone || zone.id == null) return;
    const id = String(zone.id).toLowerCase();
    const entry = {
      id,
      name: zone.name || zone.id,
      color: zone.color || null,
      min: typeof zone.min === 'number' ? zone.min : null,
      rank: index
    };
    map[id] = entry;
    rankMap[id] = index;
    infoMap[id] = { id, name: entry.name, color: entry.color };
    ranked.push(entry);
  });

  return { map, rankMap, infoMap, ranked };
}
