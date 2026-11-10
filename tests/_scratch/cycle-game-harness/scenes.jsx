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
import PaceDeltaPanel from '../../../__app_modules/wellness/fitness/browser/widgets/CycleGame/panels/PaceDeltaPanel.jsx';
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
  week: { start: '2026-06-29', end: '2099-01-01' },
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
  boostRange: { min: 0.8, max: 1.6 }, canStart: true, onStart: noop,
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
  multiplier: 1.2, finished: false, placement: 1, isLeader: false, maxRpm: 120, parked: false,
  noSensor: false, overtime: false, sensorLost: false, ...extra,
});
const withAvatar = (id, o) => ({ avatarSrc: AV(id), ...o });

// ── race fixtures ───────────────────────────────────────────────────────────
function soloRival() {
  const t = 128;
  const ghostId = 'ghost:race-1:user_1';
  return {
    winCondition: 'time', goalM: 3000, timeCapS: 300, elapsedS: t, lapLengthM: 400, cadenceBands: BANDS,
    riders: {
      user_1: rider('user_1', 'Rider A', series(t, 457)),
      [ghostId]: rider(ghostId, 'Rider A (best)', series(t, 430, { wobble: 0.2 }), { isGhost: true }),
    },
    riderLive: {
      user_1: withAvatar('user_1', live({ rpm: 86, speedKmh: 14.6, heartRate: 146, zoneId: 'warm', multiplier: 1.2, placement: 1, isLeader: true })),
      [ghostId]: withAvatar('user_1', live({ rpm: 80, speedKmh: 13.4, heartRate: 141, zoneId: 'warm', zoneColor: '#f1c40f', multiplier: 1.2, placement: 2, zoneProgress: null })),
    },
  };
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
      user_1: withAvatar('user_1', live({ rpm: 90, speedKmh: 27.8, heartRate: 158, zoneId: 'hot', zoneColor: '#e67e22', multiplier: 1.4, placement: 1, isLeader: true })),
      user_2: withAvatar('user_2', live({ rpm: 0, speedKmh: 0, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, multiplier: 1, placement: 2, parked: true })),
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
      user_1: withAvatar('user_1', live({ rpm: 92, speedKmh: 28.9, heartRate: 162, zoneId: 'hot', zoneColor: '#e67e22', multiplier: 1.4, placement: 1, isLeader: true })),
      user_2: withAvatar('user_2', live({ rpm: 88, speedKmh: 26.1, heartRate: 150, zoneId: 'warm', multiplier: 1.2, placement: 2 })),
      user_3: withAvatar('user_3', live({ rpm: 76, speedKmh: 21.2, heartRate: 128, zoneId: 'active', zoneColor: '#2ecc71', multiplier: 1, placement: 3 })),
      user_4: withAvatar('user_4', live({ rpm: 0, speedKmh: 0, heartRate: null, zoneId: null, zoneColor: null, zoneProgress: null, multiplier: 1, placement: 4, parked: true, noSensor: true })),
    },
  };
}

const RaceScreen = (p) => <CycleRaceScreen {...p} />;

// ── results fixtures ────────────────────────────────────────────────────────
const ENDED_EARLY_NOTE = 'Ended early: saved to history, not counted for records or the ladder.';

// ── staging fixtures ────────────────────────────────────────────────────────
const STAGING_RIDERS = [
  { id: 'user_1', name: 'Rider A', avatarSrc: AV('user_1'), rpm: 62, sensorLive: true, heartRate: 118, zoneColor: '#2ecc71' },
  { id: 'user_2', name: 'Rider B', avatarSrc: AV('user_2'), rpm: 0, sensorLive: false },
  { id: 'ghost:race-1:user_3', name: 'Rider C', avatarSrc: AV('user_3'), isGhost: true },
];

export const SCENES = {
  'lobby-default': { render: () => (
    <Container>
      <CycleGameHome {...homeBase}
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
  'race-solo-rival': { render: () => (<Container><RaceScreen {...soloRival()} /><RaceMenu onEnd={noop} onDiscard={noop} /></Container>) },
  'race-two-riders-one-parked': { render: () => (<Container><RaceScreen {...twoOneParked()} /><RaceMenu onEnd={noop} onDiscard={noop} /></Container>) },
  'race-four-riders': { render: () => (<Container><RaceScreen {...fourRiders()} /><RaceMenu onEnd={noop} onDiscard={noop} /></Container>) },
  'race-menu-open': { render: () => (<Container><RaceScreen {...soloRival()} /><RaceMenu onEnd={noop} onDiscard={noop} /></Container>) },
  'race-toast-parked': { render: () => (
    <Container>
      <RaceScreen {...twoOneParked()} />
      <CycleEventToast toast={{ id: 1, variant: 'parked', icon: null, title: 'Rider B is parked', subtitle: 'Pedal to rejoin' }} onDone={noop} durationMs={BIG} />
      <RaceMenu onEnd={noop} onDiscard={noop} />
    </Container>) },
  'results-normal': { render: () => (
    <Container>
      <RaceResults winCondition="distance" lapLengthM={400} elapsedS={331} secondsLeft={24} onExit={noop}
        standings={[
          { userId: 'user_1', placement: 1, finishTimeS: 301, distanceM: 2500 },
          { userId: 'user_2', placement: 2, finishTimeS: 318, distanceM: 2500 },
          { userId: 'user_3', placement: 3, finishTimeS: 331, distanceM: 2500 },
        ]}
        riders={{ user_1: { displayName: 'Rider A' }, user_2: { displayName: 'Rider B' }, user_3: { displayName: 'Rider C' } }} />
      <button type="button" className="cycle-game-container__start">Back to home</button>
    </Container>) },
  'results-stopped-and-ended-early': { render: () => (
    <Container>
      <RaceResults winCondition="time" lapLengthM={400} elapsedS={212} secondsLeft={24} onExit={noop}
        stopped={['user_2']} ladderNotes={[ENDED_EARLY_NOTE]}
        standings={[
          { userId: 'user_1', placement: 1, finishTimeS: null, distanceM: 1480 },
          { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 412 },
        ]}
        riders={{ user_1: { displayName: 'Rider A' }, user_2: { displayName: 'Rider B' } }} />
      <button type="button" className="cycle-game-container__start">Back to home</button>
    </Container>) },
};

const paceBox = (props) => ({ render: () => (
  <div style={{ width: 700, height: 320, border: '1px dashed #445', margin: 40, position: 'relative' }}>
    <PaceDeltaPanel rivalName="Rider A" rivalKind="self" zoneBox={{ width: 700, height: 320 }} {...props} />
  </div>) });
SCENES['pace-delta-ahead'] = paceBox({ delta: { gapM: 22, gapS: 6.2, ahead: true } });
SCENES['pace-delta-behind'] = paceBox({ delta: { gapM: -31, gapS: -9.1, ahead: false } });
SCENES['pace-delta-null'] = paceBox({ delta: null });
