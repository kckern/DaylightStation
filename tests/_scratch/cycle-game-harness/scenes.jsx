// Fixtures for every scene. No real household names: Rider A..D, user_N ids.
import React from 'react';

const W = '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame';
import CycleGameHome from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/CycleGameHome.jsx';
import RiderReadyStrip from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/RiderReadyStrip.jsx';
import CountdownStoplight from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/CountdownStoplight.jsx';
import CycleRaceScreen from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/CycleRaceScreen.jsx';
import RaceMenu from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/RaceMenu.jsx';
import CycleEventToast from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/CycleEventToast.jsx';
import RaceResults from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/RaceResults.jsx';
import '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/CycleGameContainer.scss';

void W;

const AV = (id) => `/api/v1/static/img/users/${id}`;
const BIKE = (id) => `/api/v1/static/img/equipment/${id}`;
const noop = () => {};
const BIG = 3600 * 1000; // keep the toast up for the whole screenshot

// Same wrapper every container phase renders inside.
const Container = ({ children }) => (
  <div className="cycle-game-container" data-testid="cycle-game-container">{children}</div>
);

// ── fixtures ────────────────────────────────────────────────────────────────
const BANDS = [
  { id: 'warmup', min: 0, color: '#5b6470' },
  { id: 'cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing', min: 70, color: '#f1c40f' },
  { id: 'sprint', min: 100, color: '#e67e22' },
];

const PEOPLE = [
  { id: 'user_1', name: 'Rider A', avatarSrc: AV('user_1'), heartRate: 128, zoneId: 'warm', zoneColor: '#f1c40f', hasHR: true, progress: 0.4 },
  { id: 'user_2', name: 'Rider B', avatarSrc: AV('user_2'), heartRate: null, zoneId: null, zoneColor: null, hasHR: false },
  { id: 'user_3', name: 'Rider C', avatarSrc: AV('user_3'), heartRate: 110, zoneId: 'active', zoneColor: '#2ecc71', hasHR: true, progress: 0.7 },
];

const RECORDS = [
  { raceId: 'r1', winnerId: 'user_1', winnerName: 'Rider A', winnerAvatar: AV('user_1'), others: [{ id: 'user_2', displayName: 'Rider B', avatarSrc: AV('user_2') }],
    speedLabel: '27.4 km/h', speedKind: 'speed', raceLabel: '5 min', raceKind: 'time', whenDay: 'Today', whenTime: '4:12 PM' },
  { raceId: 'r2', winnerId: 'user_2', winnerName: 'Rider B', winnerAvatar: AV('user_2'), others: [],
    speedLabel: '22.9 km/h', speedKind: 'speed', raceLabel: '1.5 km', raceKind: 'distance', whenDay: 'Today', whenTime: '3:40 PM' },
  { raceId: 'r3', winnerId: 'user_1', winnerName: 'Rider A', winnerAvatar: AV('user_1'),
    others: [{ id: 'ghost:r0:user_3', displayName: 'Rider C', avatarSrc: AV('user_3'), isGhost: true }],
    speedLabel: '25.1 km/h', speedKind: 'speed', raceLabel: '3 min', raceKind: 'time', whenDay: 'Yesterday', whenTime: '6:05 PM' },
  { raceId: 'r4', winnerId: 'user_3', winnerName: 'Rider C', winnerAvatar: AV('user_3'), others: [],
    speedLabel: '640 m', speedKind: 'distance', raceLabel: '1 km', raceKind: 'distance', whenDay: 'Mon', whenTime: '5:30 PM' },
];

const HIGH_SCORES = [
  { key: 'fastest-5min', label: 'Fastest 5 min', valueLabel: '27.4 km/h', raceId: 'r1', holderName: 'Rider A', holderAvatar: AV('user_1'), whenDay: 'Today', whenTime: '4:12 PM' },
  { key: 'farthest', label: 'Farthest in 10 min', valueLabel: '4.62 km', raceId: 'r3', holderName: 'Rider C', holderAvatar: AV('user_3'), whenDay: 'Mon', whenTime: '5:30 PM' },
];

const FEATURED = {
  course: { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
  week: { start: '2026-06-29', end: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) },
  standings: [
    { userId: 'user_1', bestValue: 150, raceId: 'r1', attempts: 2 },
    { userId: 'user_3', bestValue: 190.4, raceId: 'r2', attempts: 1 },
  ],
  allTimeRecord: { userId: 'user_1', bestValue: 141, raceId: 'r0', date: '2026-05-12' },
};
const NAMES = { user_1: 'Rider A', user_2: 'Rider B', user_3: 'Rider C' };

const homeBase = {
  raceType: 'time', raceValue: 300, people: PEOPLE, records: RECORDS, highScores: HIGH_SCORES,
  featured: FEATURED, onRideFeatured: noop, resolveName: (id) => NAMES[id] || id,
  canStart: true, onStart: noop,
  masterVolume: 0.7, masterMuted: false,
};

// Deterministic cumulative series: one entry per second, ending at `end` metres.
function series(seconds, end, { wobble = 0.12, startAt = 0, stopAfter = null } = {}) {
  const out = [0];
  const weights = [];
  for (let i = 1; i <= seconds; i += 1) {
    const active = stopAfter == null || i <= stopAfter;
    weights.push(active ? 1 + wobble * Math.sin(i * 0.9) + (i < 10 ? -0.5 * (10 - i) / 10 : 0) : 0);
  }
  const startIdx = startAt;
  const total = weights.reduce((a, b, i) => a + (i + 1 > startIdx ? b : 0), 0) || 1;
  let acc = 0;
  weights.forEach((w, i) => {
    if (i + 1 > startIdx) acc += (w / total) * end;
    out.push(Math.round(acc * 10) / 10);
  });
  out[out.length - 1] = end;
  return out;
}

const rider = (id, name, seriesArr, extra = {}) => ({
  userId: id, displayName: name, cumulativeDistanceM: seriesArr[seriesArr.length - 1],
  distanceSeries: seriesArr, finishTimeS: null, isGhost: false, ...extra,
});
const live = (extra = {}) => ({
  rpm: 84, speedKmh: 24.5, heartRate: 146, zoneId: 'warm', zoneColor: '#f1c40f', zoneProgress: 0.45,
  finished: false, placement: 1, isLeader: false, maxRpm: 120, parked: false,
  noSensor: false, overtime: false, sensorLost: false, ...extra,
});
const withAvatar = (id, o) => ({ avatarSrc: AV(id), ...o });

// ── race fixtures ───────────────────────────────────────────────────────────
const ZONE = {
  active: { label: 'Active', mult: 1.0, color: '#2ecc71' },
  warm: { label: 'Warm', mult: 1.2, color: '#f1c40f' },
  hot: { label: 'Hot', mult: 1.4, color: '#e67e22' },
  fire: { label: 'Fire', mult: 1.6, color: '#e74c3c' },
};
const NEXT = { active: 'warm', warm: 'hot', hot: 'fire', fire: null };
// Same shape as boostState() returns.
const boost = (zone, progress) => ({
  hasStrap: true, label: ZONE[zone].label, mult: ZONE[zone].mult, progress,
  next: NEXT[zone] ? { label: ZONE[NEXT[zone]].label, mult: ZONE[NEXT[zone]].mult } : null,
});
const NO_STRAP = { hasStrap: false, label: 'No heart-rate strap', mult: 0.8, progress: null, next: null };
const zoneLive = (zone, progress, extra = {}) => ({
  heartRate: { active: 118, warm: 146, hot: 162, fire: 176 }[zone], zoneId: zone, zoneColor: ZONE[zone].color,
  zoneProgress: progress, boost: boost(zone, progress), ...extra,
});

// A rival recording: cumulative metres, one sample per intervalS, from a
// distance-at-time function. `replayed` is the per-second part already ridden.
function recording(fn, totalS, intervalS = 5) {
  const out = [];
  for (let t = intervalS; t <= totalS + 1e-9; t += intervalS) out.push(Math.round(fn(t) * 10) / 10);
  return out;
}
function ghostRider(id, name, fn, totalS, elapsedS, intervalS = 5) {
  const replayed = [0];
  for (let t = 1; t <= elapsedS; t += 1) replayed.push(Math.round(fn(t) * 10) / 10);
  return {
    userId: id, displayName: name, cumulativeDistanceM: replayed[replayed.length - 1], distanceSeries: replayed,
    finishTimeS: null, isGhost: true, ghostRecordedSeries: recording(fn, totalS, intervalS), ghostIntervalS: intervalS,
  };
}
const ghostLive = (src, extra = {}) => ({
  rpm: 78, speedKmh: 12.3, avatarSrc: AV(src), heartRate: 141, zoneId: 'warm', zoneColor: ZONE.warm.color,
  zoneProgress: null, finished: false, placement: 2, isLeader: false, maxRpm: 120, parked: false, noSensor: false,
  boost: null, ...extra,
});

function soloTime() {
  const t = 128;
  const gid = 'ghost:race-1:user_1';
  const fn = (x) => 457 * (x / 134); // reaches 457 m at 134 s: 6 s behind the rider
  return {
    winCondition: 'time', goalM: 3000, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS, rivalKind: 'self',
    riders: { user_1: rider('user_1', 'Rider A', series(t, 457)), [gid]: ghostRider(gid, 'Rider A 👻', fn, 300, t) },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 86, speedKmh: 14.6, placement: 1, isLeader: true, ...zoneLive('warm', 0.4) })),
      [gid]: ghostLive('user_1', { speedKmh: 12.3 }),
    },
  };
}
function soloDistanceBehind() {
  const t = 210;
  const gid = 'ghost:race-2:user_2';
  // Reaches 820 m at 201 s (9 s ahead of the rider now), then 680 m more by 400 s.
  const fn = (x) => (x <= 201 ? 820 * (x / 201) : 820 + (680 * (x - 201)) / 199);
  const me = rider('user_1', 'Rider A', series(t, 820));
  return {
    winCondition: 'distance', goalM: 1500, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS, rivalKind: 'household',
    riders: { user_1: me, [gid]: ghostRider(gid, 'Rider B 👻', fn, 400, t) },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 88, speedKmh: 14.0, placement: 2, ...zoneLive('warm', 0.7) })),
      [gid]: ghostLive('user_2', { speedKmh: 14.8, placement: 1, isLeader: true }),
    },
  };
}
function soloParNoStrap() {
  const t = 90;
  const gid = 'ghost:par:par';
  const fn = (x) => 2.4 * x;
  return {
    winCondition: 'time', goalM: 3000, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS, rivalKind: 'par',
    riders: { user_1: rider('user_1', 'Rider A', series(t, 250)), [gid]: ghostRider(gid, 'Par', fn, 300, t) },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 74, speedKmh: 12.0, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP, placement: 1, isLeader: true })),
      [gid]: ghostLive('par', { speedKmh: 8.6, heartRate: null, zoneId: null }),
    },
  };
}
function soloParked() {
  const s = soloTime();
  s.riderLive.user_1 = { ...s.riderLive.user_1, rpm: 0, speedKmh: 0, parked: true };
  return s;
}
function twoOneParked() {
  const t = 180;
  return {
    winCondition: 'distance', goalM: 1500, timeCapS: 300, elapsedS: t, lapLengthM: 0, cadenceBands: BANDS,
    riders: {
      user_1: rider('user_1', 'Rider A', series(t, 902)),
      user_2: rider('user_2', 'Rider B', series(t, 310, { stopAfter: 70 })),
    },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 90, speedKmh: 27.8, placement: 1, isLeader: true, ...zoneLive('hot', 0.5) })),
      user_2: withAvatar('user_2', live({ rpm: 0, speedKmh: 0, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP, placement: 2, parked: true })),
    },
  };
}
function twoRiders() {
  const t = 180;
  return {
    winCondition: 'distance', goalM: 1500, timeCapS: 300, elapsedS: t, lapLengthM: 0, cadenceBands: BANDS,
    riders: {
      user_1: rider('user_1', 'Rider A', series(t, 902)),
      user_2: rider('user_2', 'Rider B', series(t, 840, { wobble: 0.2 })),
    },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 90, speedKmh: 27.8, placement: 1, isLeader: true, ...zoneLive('hot', 0.5) })),
      user_2: withAvatar('user_2', live({ rpm: 84, speedKmh: 25.9, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP, placement: 2 })),
    },
  };
}
function fourRiders() {
  const t = 200;
  return {
    winCondition: 'distance', goalM: 1500, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS,
    riders: {
      user_1: rider('user_1', 'Rider A', series(t, 960)),
      user_2: rider('user_2', 'Rider B', series(t, 880, { wobble: 0.2 })),
      user_3: rider('user_3', 'Rider C', series(t, 760, { wobble: 0.15 })),
      user_4: rider('user_4', 'Rider D', series(t, 120, { stopAfter: 28 })),
    },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 92, speedKmh: 28.9, placement: 1, isLeader: true, ...zoneLive('hot', 0.6) })),
      user_2: withAvatar('user_2', live({ rpm: 88, speedKmh: 26.1, placement: 2, ...zoneLive('warm', 0.8) })),
      user_3: withAvatar('user_3', live({ rpm: 76, speedKmh: 21.2, placement: 3, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP })),
      user_4: withAvatar('user_4', live({ rpm: 0, speedKmh: 0, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP, placement: 4, parked: true, noSensor: true })),
    },
  };
}
function sixRiders() { return manyRiders(6); }
// Rider A has crossed the line (rpm forced to 0 upstream): the gauge's FINISHED plate.
function fourOneFinished() {
  const s = fourRiders();
  s.riderLive.user_1 = { ...s.riderLive.user_1, rpm: 0, speedKmh: 0, finished: true, placement: 1 };
  return s;
}
function fiveRiders() { return manyRiders(5); }
// Four riders bunched within 15 m of each other: the road panel's worst case for badges.
function fourBunched() { return bunched([960, 955, 950, 946]); }
// Six riders within 20 m: forces the road panel's "+N" badge (4th-6th).
function sixBunched() { return bunched([960, 955, 950, 946, 944, 941]); }
function bunched(dist) {
  const t = 200;
  const riders = {}; const riderLive = {};
  dist.forEach((d, i) => {
    const n = i + 1; const id = `user_${n}`;
    riders[id] = rider(id, `Rider ${String.fromCharCode(64 + n)}`, series(t, d, { wobble: 0.1 + i * 0.02 }));
    riderLive[id] = withAvatar(id, live({ rpm: 90 - i, speedKmh: 28 - i * 0.2, placement: n, isLeader: i === 0, ...zoneLive(['hot', 'warm', 'warm', 'active', 'active', 'active'][i], 0.5) }));
  });
  return { winCondition: 'distance', goalM: 1500, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS, riders, riderLive };
}
function manyRiders(count) {
  const t = 200;
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const dist = [960, 900, 840, 780, 520, 120].slice(0, count);
  const lastParked = count === 6;
  const riders = {}; const riderLive = {};
  ids.forEach((n, i) => {
    const id = `user_${n}`;
    riders[id] = rider(id, `Rider ${String.fromCharCode(64 + n)}`, series(t, dist[i], lastParked && i === 5 ? { stopAfter: 28 } : { wobble: 0.1 + i * 0.02 }));
    riderLive[id] = withAvatar(`user_${n}`, lastParked && i === 5
      ? live({ rpm: 0, speedKmh: 0, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP, placement: 6, parked: true, noSensor: true })
      : i === 4
        ? live({ rpm: 90 - i * 3, speedKmh: 28 - i, placement: i + 1, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, boost: NO_STRAP })
        : live({ rpm: 90 - i * 3, speedKmh: 28 - i, placement: i + 1, isLeader: i === 0, ...zoneLive(['hot', 'warm', 'warm', 'active', 'active'][i], 0.5) }));
  });
  return { winCondition: 'distance', goalM: 1500, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS, riders, riderLive };
}
const RaceScreen = (p) => <CycleRaceScreen {...p} />;

// ── results fixtures ────────────────────────────────────────────────────────
const ENDED_EARLY_NOTE = 'Ended early: saved to history, not counted for records or the ladder.';
const NAME = (n) => ({ displayName: `Rider ${n}` });
// Mounted exactly as CycleGameContainer's results branch does (the last `return`
// in render): the container wrapper around RaceResults and nothing else. The
// board owns its own Rematch / Back to home buttons.
const ResultsPhase = (props) => (
  <Container>
    <RaceResults onExit={noop} {...props} />
  </Container>
);

// ── staging fixtures ────────────────────────────────────────────────────────
const STAGING_RIDERS = [
  { id: 'user_1', name: 'Rider A', avatarSrc: AV('user_1'), rpm: 62, sensorLive: true, heartRate: 118, zoneColor: '#2ecc71' },
  { id: 'user_2', name: 'Rider B', avatarSrc: AV('user_2'), rpm: 0, sensorLive: false, noStrapMultiplier: 0.8 },
  { id: 'ghost:race-1:user_3', name: 'Rider C', avatarSrc: AV('user_3'), isGhost: true },
];

const raceScene = (fx, extra = null) => ({ render: () => (
  <Container><RaceScreen {...fx()} />{extra}<RaceMenu onEnd={noop} onDiscard={noop} /></Container>) });
const toastScene = (fx, toast) => ({ render: () => (
  <Container><RaceScreen {...fx()} />
    <CycleEventToast toast={toast} onDone={noop} durationMs={BIG} />
    <RaceMenu onEnd={noop} onDiscard={noop} /></Container>) });

const GHOST_CANDIDATES = [
  ['R1', '2026-06-06', '08:00', 'distance', ['user_1', 'user_2']],
  ['R2', '2026-06-06', '09:30', 'time', ['user_1']],
  ['R3', '2026-06-05', '18:10', 'distance', ['user_1', 'user_2', 'user_3']],
  ['R4', '2026-06-04', '07:45', 'time', ['user_3', 'user_2']],
].map(([raceId, day, timeOfDay, winCondition, ids]) => ({
  raceId, day, timeOfDay, winCondition, goalLabel: 'Race',
  participants: ids.map((id, i) => ({ id, displayName: NAMES[id], isGhost: false, avatarSrc: AV(id), finalDistanceM: 3000 - i * 240, finalTimeS: 600 + i * 40 })),
}));
const TWO_BIKES = [
  { id: 'bike-1', name: 'Bike 1', rider: 'user_1', rpm: 62, sensorLive: true, iconSrc: BIKE('bike-1') },
  { id: 'bike-2', name: 'Bike 2', rider: null, rpm: 0, iconSrc: BIKE('bike-2') },
];
const lobbyModal = (extra = {}) => ({ render: () => (
  <Container><CycleGameHome {...homeBase} ghostCandidates={GHOST_CANDIDATES} bikes={TWO_BIKES} {...extra} /></Container>) });

// A past race with six riders (the widest card the picker has to fit).
const SIX_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
const SIX_RACE = {
  raceId: 'R6', day: '2026-06-06', timeOfDay: '10:15', winCondition: 'distance', goalLabel: 'Race',
  participants: SIX_NAMES.map((n, i) => ({ id: `user_${i + 1}`, displayName: `Rider ${n}`, isGhost: false, avatarSrc: AV(`user_${i + 1}`), finalDistanceM: 3000 - i * 240, finalTimeS: 600 + i * 40 })),
};
const lobbySix = () => lobbyModal({ ghostCandidates: [...GHOST_CANDIDATES, SIX_RACE] });

export const SCENES = {
  'lobby-ghost-picker-six': lobbySix(),
  'lobby-ghost-roster-six': lobbySix(),
  'lobby-rider-picker': lobbyModal(),
  'lobby-ghost-picker': lobbyModal(),
  'lobby-ghost-roster': lobbyModal(),
  'lobby-volume': lobbyModal(),
  'lobby-default': { render: () => (
    <Container>
      <CycleGameHome {...homeBase}
        bikes={[
          { id: 'bike-1', name: 'Bike 1', rider: 'user_1', rpm: 62, sensorLive: true, iconSrc: BIKE('bike-1') },
          { id: 'bike-2', name: 'Bike 2', rider: null, rpm: 0, iconSrc: BIKE('bike-2') },
        ]} />
    </Container>) },
  // A full history: the rail must show only the rows that fit whole.
  'lobby-history-full': { render: () => (
    <Container>
      <CycleGameHome {...homeBase}
        records={Array.from({ length: 12 }, (_, i) => ({ ...RECORDS[i % 4], raceId: `rx${i}`, whenDay: ['Today', 'Today', 'Yesterday', 'Mon', 'Sun', 'Sat'][Math.floor(i / 2)] }))}
        bikes={[
          { id: 'bike-1', name: 'Bike 1', rider: 'user_1', rpm: 62, sensorLive: true, iconSrc: BIKE('bike-1') },
          { id: 'bike-2', name: 'Bike 2', rider: null, rpm: 0, iconSrc: BIKE('bike-2') },
        ]} />
    </Container>) },
  'lobby-no-signal': { render: () => (
    <Container>
      <CycleGameHome {...homeBase}
        bikes={[{ id: 'bike-1', name: 'Bike 1', rider: 'user_1', rpm: 0, sensorLive: false, iconSrc: BIKE('bike-1') }]} />
    </Container>) },
  // The garage at 19:29 on 2026-11-10: Distance picked (the "how far" row
  // open), five bikes, one rider. Every grid tile must stay whole.
  'lobby-garage-five': { render: () => (
    <Container>
      <CycleGameHome {...homeBase} raceType="distance" raceValue={300} onToggleRaceMyBest={noop}
        bikes={Array.from({ length: 5 }, (_, i) => ({ id: `bike-${i + 1}`, name: `Bike ${i + 1}`, rider: i === 2 ? 'user_1' : null, rpm: i === 2 ? 62 : 0, sensorLive: i === 2, iconSrc: BIKE(`bike-${i + 1}`) }))} />
    </Container>) },
  'lobby-garage-one': { render: () => (
    <Container>
      <CycleGameHome {...homeBase} raceType="distance" raceValue={300} onToggleRaceMyBest={noop}
        bikes={[{ id: 'bike-1', name: 'Bike 1', rider: 'user_1', rpm: 62, sensorLive: true, iconSrc: BIKE('bike-1') }]} />
    </Container>) },
  'lobby-garage-time': { render: () => (
    <Container>
      <CycleGameHome {...homeBase} raceType="time" raceValue={300} onToggleRaceMyBest={noop} raceMyBest
        bikes={Array.from({ length: 6 }, (_, i) => ({ id: `bike-${i + 1}`, name: `Bike ${i + 1}`, rider: i === 0 ? 'user_1' : null, rpm: i === 0 ? 62 : 0, sensorLive: i === 0, iconSrc: BIKE(`bike-${i + 1}`) }))} />
    </Container>) },
  // A hand-picked ghost: the value row becomes the ghost summary and the ghost's
  // field joins the grid (six lanes in all).
  'lobby-garage-ghost': { render: () => (
    <Container>
      <CycleGameHome {...homeBase} raceType="distance" raceValue={1000} onToggleRaceMyBest={noop}
        ghost={{ displayName: 'Rider C', winCondition: 'distance', goalM: 1000 }}
        ghostRoster={[{ userId: 'ghost:r3:user_3', displayName: 'Rider C', avatarSrc: AV('user_3') }, { userId: 'ghost:r3:user_2', displayName: 'Rider B', avatarSrc: AV('user_2') }]}
        bikes={Array.from({ length: 4 }, (_, i) => ({ id: `bike-${i + 1}`, name: `Bike ${i + 1}`, rider: i === 0 ? 'user_1' : null, rpm: i === 0 ? 62 : 0, sensorLive: i === 0, iconSrc: BIKE(`bike-${i + 1}`) }))} />
    </Container>) },
  'lobby-garage-six': { render: () => (
    <Container>
      <CycleGameHome {...homeBase} raceType="distance" raceValue={300}
        bikes={Array.from({ length: 6 }, (_, i) => ({ id: `bike-${i + 1}`, name: `Bike ${i + 1}`, rider: i < 3 ? ['user_1', 'user_2', 'user_3'][i] : null, rpm: i < 3 ? 62 : 0, sensorLive: i < 3, iconSrc: BIKE(`bike-${i + 1}`) }))} />
    </Container>) },
  'lobby-busy': { render: () => (
    <Container>
      <CycleGameHome {...homeBase} busy
        bikes={[
          { id: 'bike-1', name: 'Bike 1', rider: 'user_1', rpm: 62, sensorLive: true, iconSrc: BIKE('bike-1') },
          { id: 'bike-2', name: 'Bike 2', rider: 'user_3', rpm: 0, sensorLive: true, iconSrc: BIKE('bike-2') },
        ]} />
    </Container>) },
  staging: { render: () => (
    <Container>
      <div className="cycle-game-staging" data-testid="cycle-game-staging">
        <div className="cycle-game-staging__eyebrow">Riders, to your bikes!</div>
        <div className="cycle-game-staging__count">7</div>
        <div className="cycle-game-staging__bar" data-testid="staging-bar">
          <span style={{ animationDuration: '600000ms' }} />
        </div>
        <RiderReadyStrip riders={STAGING_RIDERS} />
        <div className="cycle-game-staging__hint">Pedal when you see green.</div>
      </div>
      <RaceMenu canEnd={false} onDiscard={noop} />
    </Container>) },
  countdown: { render: () => (
    <Container>
      <CountdownStoplight remaining={2} total={5} />
      <div className="cycle-game-countdown-riders">
        <RiderReadyStrip riders={STAGING_RIDERS} />
      </div>
      <RaceMenu canEnd={false} onDiscard={noop} />
    </Container>) },
  'race-solo-time': raceScene(soloTime),
  'race-solo-distance-behind': raceScene(soloDistanceBehind),
  'race-solo-par-no-strap': raceScene(soloParNoStrap),
  'race-solo-parked': raceScene(soloParked),
  'race-two-riders-one-parked': raceScene(twoOneParked),
  'race-two-riders': raceScene(twoRiders),
  'race-three-riders': raceScene(() => manyRiders(3)),
  'race-four-riders': raceScene(fourRiders),
  'race-five-riders': raceScene(fiveRiders),
  'race-six-riders': raceScene(sixRiders),
  'race-four-bunched': raceScene(fourBunched),
  'race-four-one-finished': raceScene(fourOneFinished),
  'race-six-bunched': raceScene(sixBunched),
  'race-menu-open': raceScene(soloTime),
  'race-toast-parked': toastScene(twoOneParked, { id: 1, variant: 'parked', icon: null, title: 'Rider B is parked', subtitle: 'Pedal to rejoin' }),
  'race-toast-boost': toastScene(soloTime, { id: 2, variant: 'boost', icon: null, title: 'Rider A: Hot \u00d71.4' }),
  'race-toast-solo': toastScene(soloTime, { id: 3, variant: 'parked', icon: null, title: 'Rider A is parked', subtitle: 'Pedal to rejoin' }),
  'race-toast-four': toastScene(fourRiders, { id: 4, variant: 'lead-change', icon: null, title: 'Rider B takes the lead', subtitle: 'by 12 m' }),
  'results-solo-new-best': { render: () => (
    <ResultsPhase winCondition="time" lapLengthM={400} elapsedS={300} secondsLeft={38} onRematch={noop}
      rivalId="ghost:race-1:user_1" rivalLabel="your best"
      standings={[
        { userId: 'user_1', placement: 1, finishTimeS: null, distanceM: 1032 },
        { userId: 'ghost:race-1:user_1', placement: 2, finishTimeS: null, distanceM: 1010 },
      ]}
      riders={{ user_1: NAME('A'), 'ghost:race-1:user_1': { displayName: 'Rider A \u{1F47B}', isGhost: true } }}
      comparisons={{ user_1: { isBest: true, vsBest: -22, vsLast: -40, better: true } }} />) },
  'results-three-riders': { render: () => (
    <ResultsPhase winCondition="distance" lapLengthM={400} elapsedS={331} secondsLeft={38} onRematch={noop}
      standings={[
        { userId: 'user_1', placement: 1, finishTimeS: 301, distanceM: 2500 },
        { userId: 'user_2', placement: 2, finishTimeS: 318, distanceM: 2500 },
        { userId: 'user_3', placement: 3, finishTimeS: 331, distanceM: 2500 },
      ]}
      riders={{ user_1: NAME('A'), user_2: NAME('B'), user_3: NAME('C') }}
      comparisons={{ user_2: { isBest: false, vsBest: 14, vsLast: -6, better: false } }} />) },
  'results-six-riders': { render: () => (
    <ResultsPhase winCondition="distance" lapLengthM={400} elapsedS={420} secondsLeft={38} onRematch={noop}
      stopped={['user_5']} overtime={['user_6']}
      standings={[
        { userId: 'user_1', placement: 1, finishTimeS: 301, distanceM: 2500 },
        { userId: 'user_2', placement: 2, finishTimeS: 318, distanceM: 2500 },
        { userId: 'user_3', placement: 3, finishTimeS: 331, distanceM: 2500 },
        { userId: 'user_4', placement: 4, finishTimeS: 352, distanceM: 2500 },
        { userId: 'user_5', placement: 5, finishTimeS: null, distanceM: 1410 },
        { userId: 'user_6', placement: 6, finishTimeS: null, distanceM: 2210 },
      ]}
      riders={{ user_1: NAME('A'), user_2: NAME('B'), user_3: NAME('C'), user_4: NAME('D'), user_5: NAME('E'), user_6: NAME('F') }} />) },
  'results-stopped-and-ended-early': { render: () => (
    <ResultsPhase winCondition="time" lapLengthM={400} elapsedS={212} secondsLeft={38} onRematch={noop}
      stopped={['user_2']} ladderNotes={[ENDED_EARLY_NOTE]}
      standings={[
        { userId: 'user_1', placement: 1, finishTimeS: null, distanceM: 1480 },
        { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 412 },
      ]}
      riders={{ user_1: NAME('A'), user_2: NAME('B') }} />) },
};
