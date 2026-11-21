// Bike order is household config: each equipment entry may carry
// `skyline_glider.priority` (lower first). Unranked bikes follow, in config order.
const priority = (item) => {
  const value = Number(item?.skyline_glider?.priority);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};
const byPriority = (left, right) => {
  const a = priority(left.equipment), b = priority(right.equipment);
  return (a === b ? 0 : a < b ? -1 : 1) || left.index - right.index;
};

export function listUsableSkylineBikes(equipment = [], session) {
  return (Array.isArray(equipment) ? equipment : [])
    .filter((item) => item?.cadence != null)
    .map((item, index) => ({
      equipment: item,
      riderId: session?.getEquipmentRider?.(item.id) || null,
      cadence: session?.getEquipmentCadence?.(item.id) || { connected: false, rpm: 0 },
      index,
    }))
    .filter(({ riderId, cadence }) => riderId && cadence.connected && !cadence.transportStalled)
    .sort(byPriority)
    .map(({ index: _index, ...item }) => item);
}

export function selectSkylineBike(equipment = [], session, preferredId = null) {
  const usable = listUsableSkylineBikes(equipment, session);
  return usable.find((item) => item.equipment.id === preferredId) || usable[0] || null;
}
