// Flow scenes: the REAL CycleGameContainer, driven lobby -> "Ride it" -> grid ->
// race, with a stub FitnessContext and an in-page fetch stub (no backend, no
// WebSocket). Mirrors the 2026-11-11 garage case: two riders, a non-rider #1 on
// the weekly course. Ids are user_N; names Rider A..D.
import React from 'react';
import { FitnessContext } from './stubs/FitnessContext.jsx';
import { VolumeProvider } from '../../../__app_modules/wellness/fitness/browser/nav/VolumeProvider.jsx';
import CycleGameContainer from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/CycleGameContainer.jsx';
import { SessionSerializerV3 } from '../../../__app_modules/wellness/fitness/browser/hooks/fitness/SessionSerializerV3.js';

const GOAL_M = 1500;
const LEAD_RACE = '20261110081048';
const COURSE = { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: GOAL_M };
const NAMES = { user_1: 'Rider A', user_2: 'Rider B', user_3: 'Rider C', user_4: 'Rider D' };

const series = (secs, m) => SessionSerializerV3.encodeSeries(Array.from({ length: secs + 1 }, (_, i) => Math.round((m * i) / secs)));
const leadRecord = {
  version: 1,
  race: { id: LEAD_RACE, win_condition: 'distance', goal_m: GOAL_M, interval_seconds: 1, course_id: COURSE.id },
  participants: {
    user_3: { display_name: 'Rider C', final_distance_m: GOAL_M, final_time_s: 314, placement: 1, distance_series: series(314, GOAL_M) },
    // The leader raced a ghost on that run: it must NOT replay on the weekly course.
    'ghost:20261109181504:user_4': { display_name: 'Rider D 👻', final_distance_m: GOAL_M, final_time_s: 342, placement: 2, distance_series: series(342, GOAL_M) }
  }
};
const LADDERS = {
  leader: {
    course: COURSE,
    week: { start: '2026-11-09', end: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) },
    standings: [
      { userId: 'user_3', bestValue: 313.8, raceId: LEAD_RACE, attempts: 2 },
      { userId: 'user_1', bestValue: 330.3, raceId: '20261110122811', attempts: 1 },
      { userId: 'user_4', bestValue: 342.1, raceId: '20261111070309', attempts: 2 }
    ],
    allTimeRecord: { userId: 'user_3', bestValue: 313.8, raceId: LEAD_RACE, date: '2026-11-10' }
  },
  empty: {
    course: COURSE,
    week: { start: '2026-11-09', end: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) },
    standings: [], allTimeRecord: null
  }
};

const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
function installFetch(ladder) {
  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (!u.includes('/api/v1/fitness/')) return real(url, opts);
    if (u.includes('/cycle-races/ladder')) return ok(ladder);
    if (u.includes('/cycle-races/rival-pool')) return ok({ entries: [] });
    if (u.includes('/personal-bests')) return ok({ best: null });
    if (u.includes(`/cycle-races/${LEAD_RACE}`)) return ok({ race: leadRecord });
    if (u.includes('?date=')) return ok({ races: [] });
    if (/\/cycle-races\/?$/.test(u.split('?')[0])) return ok({ dates: ['2026-11-10'] });
    if (u.includes('/cycle-races') && opts?.method === 'POST') return ok({ ok: true });
    return Promise.resolve(new Response('not stubbed', { status: 404 }));
  };
}

function makeCtx() {
  const riders = { 'bike-1': 'user_1', 'bike-2': 'user_2' };
  const vitals = {
    user_1: { name: 'Rider A', heartRate: 132, zoneId: 'warm', zoneColor: '#f1c40f' },
    user_2: { name: 'Rider B', heartRate: 118, zoneId: 'active', zoneColor: '#2ecc71' }
  };
  return {
    equipment: [
      { id: 'bike-1', name: 'Bike 1', cadence: 1001, wheel_circumference_m: 2.1 },
      { id: 'bike-2', name: 'Bike 2', cadence: 1002, wheel_circumference_m: 2.1 }
    ],
    configuredUsers: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
    zones: [
      { id: 'active', distance_multiplier: 1.0, color: '#2ecc71' },
      { id: 'warm', distance_multiplier: 1.2, color: '#f1c40f' }
    ],
    cycleGameConfig: {
      default_win_condition: 'distance', distance_goal_default_m: 1500, time_cap_default_s: 300,
      hrless_multiplier: 1.0, start_countdown_s: 3, staging_buffer_ms: 4000,
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }]
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: () => ({ rpm: 85, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => NAMES[id] || id,
    getUserByName: (id) => ({ name: NAMES[id] || id }),
    setGovernanceSuspended: () => {}
  };
}

const Flow = ({ ladder }) => {
  const ctx = React.useMemo(() => { installFetch(LADDERS[ladder]); return makeCtx(); }, [ladder]);
  return <VolumeProvider><FitnessContext.Provider value={ctx}><CycleGameContainer /></FitnessContext.Provider></VolumeProvider>;
};

export const FLOW_SCENES = {
  'flow-weekly-ghost': { render: () => <Flow ladder="leader" /> },
  'flow-weekly-ghost-empty': { render: () => <Flow ladder="empty" /> }
};
