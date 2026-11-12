// Harness-only stand-in for the fitness context: a session with one step mat,
// one bike, and placeholder people. `?shooter=none` leaves the mat with no rider;
// `?mat=none` removes the mat; `?partner=1` puts a rider on the bike.
const params = new URLSearchParams(location.search);
const listeners = new Map();
const riders = { 'step-mat': params.get('shooter') === 'none' ? null : 'kid', bike: params.get('partner') ? 'test-rider' : null };
const zone = params.get('zone') || 'warm';
const ctx = {
  equipment: [
    ...(params.get('mat') === 'none' ? [] : [{ id: 'step-mat', type: 'pressure_mat', pressure_mat: 'mat-a1' }]),
    { id: 'bike', cadence: 7 },
  ],
  users: [{ id: 'kid', name: 'Kid' }, { id: 'test-rider', name: 'Test Rider' }, { id: 'other', name: 'Other' }],
  participantRoster: [],
  fitnessSessionInstance: {
    sessionId: 'fs-harness',
    treasureBox: { awardBonus: () => {} },
    getEquipmentRider: (id) => riders[id] || null,
    setEquipmentUser: (id, userId) => { riders[id] = userId; },
    getEquipmentCadence: () => ({ rpm: 95, connected: !!riders.bike }),
    zoneProfileStore: { getProfile: () => ({ zoneTrusted: true, zoneReadingEligible: true, zoneReadingAt: Date.now(), currentZoneId: zone }) },
  },
  getUserByName: (id) => ({ id, schoolLearner: true }),
  subscribeToAppEvent: (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
    return () => listeners.get(type)?.delete(callback);
  },
  setGovernanceSuspended: () => {},
};
window.__si = window.__si || {};
window.__si.step = (id = 'mat-a1') => listeners.get('pressure-mat:step')?.forEach((callback) => callback({ type: 'pressure-mat:step', payload: { id }, source: id, timestamp: Date.now() }));
export const useFitnessContext = () => ctx;
export default { useFitnessContext };
