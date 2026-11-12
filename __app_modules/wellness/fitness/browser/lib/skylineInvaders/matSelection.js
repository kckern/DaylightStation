import { isPressureMatEntry } from '../../hooks/fitness/PressureMatActivityTracker.js';

// A step mat has two ids. The session API (riders) takes the equipment id; the
// app-event bus (`pressure-mat:step`) carries the hardware id. Both travel
// together from here so no caller has to map one to the other.
const hardwareId = (item) => item?.pressure_mat ?? item?.pressureMat ?? item?.sensor?.pressure_mat ?? null;

/** Step mats that can fire: `{ equipmentId, matId (hardware), riderId }`. A mat with no hardware id is left out. */
export function listInvadersMats(equipment = [], session) {
  return (Array.isArray(equipment) ? equipment : [])
    .filter((item) => item?.id != null && isPressureMatEntry(item) && hardwareId(item) != null)
    .map((item) => ({ equipmentId: String(item.id), matId: String(hardwareId(item)), riderId: session?.getEquipmentRider?.(item.id) || null }));
}

/** The asked-for mat, else one with an in-session rider, else the first. null with no mat. */
export function selectInvadersMat(equipment = [], session, preferredEquipmentId = null) {
  const mats = listInvadersMats(equipment, session);
  return mats.find((mat) => mat.equipmentId === preferredEquipmentId) || mats.find((mat) => mat.riderId) || mats[0] || null;
}
