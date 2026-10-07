const priority = (id) => id === 'niceday' ? 0 : id === 'cycle_ace' ? 1 : 2;

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
    .sort((left, right) => priority(left.equipment.id) - priority(right.equipment.id) || left.index - right.index)
    .map(({ index: _index, ...item }) => item);
}

export function selectSkylineBike(equipment = [], session, preferredId = null) {
  const usable = listUsableSkylineBikes(equipment, session);
  return usable.find((item) => item.equipment.id === preferredId) || usable[0] || null;
}
