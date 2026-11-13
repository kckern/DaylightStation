import { createSelectorInputRouter } from '../../../../__app_modules/wellness/fitness/browser/lib/selectorInputRouter.js';
// Harness-only stand-in for the fitness context: a session with one step mat,
// one bike, and placeholder people. `?shooter=none` leaves the mat with no rider;
// `?mat=none` removes the mat; `?partner=1` puts a rider on the bike.
const params = new URLSearchParams(location.search);
const listeners = new Map();
const riders = { 'step-mat': params.get('shooter') === 'none' ? null : 'kid', bike: params.get('partner') ? 'test-rider' : null };
const ctx = {
  equipment: [
    ...(params.get('mat') === 'none' ? [] : [{ id: 'step-mat', type: 'pressure_mat', pressure_mat: 'mat-a1' }]),
    { id: 'bike', cadence: 7 },
  ],
  users: [{ id: 'kid', name: 'Kid' }, { id: 'test-rider', name: 'Test Rider' }, { id: 'other', name: 'Other' }],
  // `?roster=kid,test-rider`: who is in the session. `?learners=kid`: only these are school learners.
  participantRoster: (params.get('roster') || '').split(',').filter(Boolean).map((id) => ({ id, name: id === 'kid' ? 'Kid' : id === 'test-rider' ? 'Test Rider' : id })),
  fitnessSessionInstance: {
    sessionId: 'fs-harness',
    treasureBox: { awardBonus: () => {} },
    getEquipmentRider: (id) => riders[id] || null,
    setEquipmentUser: (id, userId) => { riders[id] = userId; },
    getEquipmentCadence: () => ({ rpm: 95, connected: !!riders.bike }),
  },
  getUserByName: (id) => ({ id, schoolLearner: params.has('learners') ? params.get('learners').split(',').includes(id) : true }),
  subscribeToAppEvent: (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
    return () => listeners.get(type)?.delete(callback);
  },
  setGovernanceSuspended: () => {},
  selectorInputRouter: createSelectorInputRouter(),
};
window.__si = window.__si || {};
window.__si.step = (id = 'mat-a1') => listeners.get('pressure-mat:step')?.forEach((callback) => callback({ type: 'pressure-mat:step', payload: { id }, source: id, timestamp: Date.now() }));
window.__si.stomp = (id = 'mat-a1') => listeners.get('pressure-mat:stomp')?.forEach((callback) => callback({ type: 'pressure-mat:stomp', payload: { id }, source: id, timestamp: Date.now() }));
window.__si.bike = (action) => ctx.selectorInputRouter.route({ action, selectorId: 'bike-buttons', equipmentId: 'bike' });
export const useFitnessContext = () => ctx;
export default { useFitnessContext };
