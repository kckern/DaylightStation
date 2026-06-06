/**
 * useEquipmentFanSync - pushes live RPM + HR-zone state to the backend so the
 * GarageFanAdapter can decide whether to fire equipment fans. Fire-and-forget;
 * the backend owns all condition logic and the per-session latch.
 *
 * The rpm map is keyed by the device id (`device.deviceId`, which matches
 * `equipment[].cadence` in config, e.g. '7138') and its value is the live
 * cadence reading (`device.cadence`) - the same field the RPM meters read
 * (see FullscreenVitalsOverlay.jsx: `Math.round(device.cadence || 0)`).
 */
import { useFitnessStateSync } from './useFitnessStateSync.js';

function rpmMap(rpmDevices) {
  const map = {};
  for (const d of Array.isArray(rpmDevices) ? rpmDevices : []) {
    if (d?.deviceId == null) continue;
    const v = Number(d.cadence ?? 0);
    map[String(d.deviceId)] = Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }
  return map;
}

function zonesPayload(roster) {
  return (Array.isArray(roster) ? roster : []).map((z) => ({
    zoneId: z.rawZoneId || z.zoneId || null,
    isActive: z.isActive !== false
  }));
}

export function useEquipmentFanSync({
  rpmDevices = [],
  participantRoster = [],
  sessionActive = false,
  enabled = false,
  householdId = null
}) {
  useFitnessStateSync({
    endpoint: 'api/v1/fitness/equipment_fan',
    enabled,
    sessionActive,
    throttleMs: 5000,
    debounceMs: 1000,
    buildSignature: () => {
      const r = rpmMap(rpmDevices);
      const maxZone = zonesPayload(participantRoster)
        .filter((z) => z.isActive)
        .map((z) => z.zoneId)
        .sort()
        .join(',');
      // Bucket rpm so micro-fluctuations don't spam; fire when crossing the
      // pedalling threshold. The backend re-checks each equipment's min_rpm.
      const rpmSig = Object.entries(r)
        .map(([k, v]) => `${k}:${v >= 30 ? 'go' : 'lo'}`)
        .sort()
        .join(',');
      return `${rpmSig}|${maxZone}`;
    },
    buildPayload: () => ({
      rpm: rpmMap(rpmDevices),
      zones: zonesPayload(participantRoster),
      sessionEnded: false,
      householdId,
      timestamp: Date.now()
    }),
    buildEndPayload: () => ({
      rpm: {},
      zones: [],
      sessionEnded: true,
      householdId,
      timestamp: Date.now()
    })
  });
}

export default useEquipmentFanSync;
