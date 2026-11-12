// UI fixture scenes for the Skyline skin harness: the flight HUD over the real
// scene, the flight overlays, every menu phase and the bike-button panel.
//   /?scene=flight&act=cloud-ridge&zone=smw-placeholder&t=22&alt=0.4&fx=impacts,flash-deny
//   /?scene=menu&phase=flights
// The shells below repeat the container's own markup (SkylineGlider.jsx) so the
// stylesheet sees the same tree it sees in the app; no backend, no controller.
import React from 'react';
import { FlightScene } from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/FlightScene.jsx';
import RpmGauge from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineRpmGauge.jsx';
import SkylineFlightHud from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineFlightHud.jsx';
import SkylineFlightOverlays from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineFlightOverlays.jsx';
import SkylineMenus from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineMenus.jsx';
import SkylineControlPanel from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineControlPanel.jsx';
import { createSkylineControlState, describeSkylineControls } from '../../../__app_modules/wellness/fitness/browser/lib/skylineGlider/controllerModel.js';
import { MomentBanner } from '../../../__capabilities/gaming/browser/platform/ui/hud/index.js';

const has = (fx, name) => fx.includes(name);

// One frame of a flight in progress, with whatever effects the shot asks for.
export function flightFixture(base, course, t, fx) {
  const entity = (role) => (course.entities || []).find((e) => (e.role === role || e.required_weapon === role) && e.at_s > t - 2 && e.at_s < t + 9);
  const shoot = entity('shoot');
  const state = {
    ...base, inputReady: true, rawRpm: 64, targetAltitude: Math.max(0.1, base.altitude - 0.08),
    lives: 2, collectedIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], bombsLeft: 4, missilesLeft: 2,
  };
  if (has(fx, 'charging')) state.boostRechargeRemaining = 5;
  if (has(fx, 'boosting')) { state.boostRemaining = 1; }
  if (has(fx, 'empty')) { state.bombsLeft = 0; state.missilesLeft = 0; }
  if (has(fx, 'hurt')) state.invincibleRemaining = 1;
  if (has(fx, 'shots')) state.projectiles = [
    { id: 'laser-1', kind: 'laser', at_s: t + 2.2, altitude: state.altitude, power: 1 },
    { id: 'missile-1', kind: 'missile', at_s: t + 3.4, altitude: state.altitude + 0.06, power: 1 },
    { id: 'bomb-1', kind: 'bomb', at_s: t + 0.8, altitude: state.altitude + 0.14, power: 1 },
  ];
  if (has(fx, 'impacts')) {
    state.impacts = [
      { id: 'kill-1', effect: 'kill', at_s: t + 3.2, altitude: 0.3 },
      { id: 'damage-1', effect: 'damage', at_s: t + 4.6, altitude: 0.45, entityId: shoot?.id },
      { id: 'absorbed-1', effect: 'absorbed', at_s: t + 5.6, altitude: 0.55 },
    ];
    if (shoot) state.entityDamage = { [shoot.id]: 1 };
  }
  if (has(fx, 'crashed')) { state.phase = 'crashed'; state.crashCause = 'terrain'; }
  if (has(fx, 'waiting')) state.inputReady = false;
  if (has(fx, 'reconnect')) state.pausedForSensor = true;
  if (has(fx, 'stall')) state.stalled = true;
  return state;
}

export function FlightUi({ state, course, assets, fx }) {
  const press = has(fx, 'flash-deny') ? { position: 2, ok: false, reason: 'empty', key: 1 }
    : has(fx, 'flash-ok') ? { position: 1, ok: true, key: 1 } : null;
  const effects = { collisionKey: has(fx, 'hurt') ? 1 : 0, pops: has(fx, 'pop') ? [{ key: 'p' }] : [], banner: null };
  const banner = has(fx, 'banner') ? 'Fly through the gap in the gate. Bottom right boosts you ahead.' : has(fx, 'checkpoint') ? 'Checkpoint 2' : null;
  return <main className="skyline-glider skyline-glider--flight" data-harness-ready="true" data-testid="skyline-glider-flight">
    <FlightScene state={state} course={course} effects={effects} assets={assets}/>
    <RpmGauge state={state}/>
    <SkylineFlightHud flight={state} course={course} armed={!has(fx, 'unarmed')} press={press} targetsHit={3} power={has(fx, 'power') ? 3 : 1}/>
    <SkylineFlightOverlays flight={state}/>
    <MomentBanner text={banner} momentKey={banner} className="skyline-glider__checkpoint-banner"/>
  </main>;
}

const avatar = (name) => `/media/img/users/${name}.jpg`;
const RIDERS = [
  { id: 'kid-a', name: 'Robin', position: 1, avatarSrc: avatar('guest-kid'), gestureHint: 'Press' },
  { id: 'kid-b', name: 'Sparrow', position: 2, avatarSrc: avatar('popeye'), gestureHint: 'Press' },
  { id: 'adult', name: 'Dad', position: 3, avatarSrc: avatar('guest-adult'), gestureHint: 'Press' },
];
const ACTS = [
  { id: 'mountain-pass', name: 'Mountain Pass', status: 'completed' },
  { id: 'cloud-ridge', name: 'Cloud Ridge', status: 'open' },
  { id: 'ember-caves', name: 'Ember Caves', status: 'locked' },
  { id: 'storm-front', name: 'Storm Front', status: 'locked' },
];
const SUMMARY = [['Bells', 41], ['Targets', 9], ['Score', 50], ['Bumps', 2]];

export function MenuUi({ phase }) {
  const base = { ...createSkylineControlState({ riders: RIDERS, acts: ACTS }), riderId: 'kid-a', actId: 'cloud-ridge', weaponsEnabled: true, cadence: { rpm: 47 }, countdown: 2.4 };
  const saveError = phase === 'result-error';
  const state = { ...base, phase: saveError ? 'result' : phase, saveStatus: saveError ? 'error' : phase === 'result' ? 'saved' : 'idle',
    accessReason: 'Finish today’s school work to unlock flying.', rosterIndex: 1 };
  const loading = phase === 'loading';
  const controls = describeSkylineControls(state).map((c) => (loading ? { ...c, disabled: true } : c));
  const testid = state.phase === 'denied' ? 'skyline-glider-school-lock' : ['result', 'saving'].includes(state.phase) ? 'skyline-glider-result' : state.phase === 'countdown' ? 'skyline-glider-countdown' : 'skyline-glider-lobby';
  if (loading) return <main className="skyline-glider skyline-glider--controls skyline-menu-screen" data-harness-ready="true" data-testid="skyline-glider-loading"><p className="skyline-glider__notice">Charting the course…</p><SkylineControlPanel controls={controls} onPress={() => {}}/></main>;
  return <main className="skyline-glider skyline-glider--controls skyline-menu-screen" data-harness-ready="true" data-testid={testid} data-control-phase={state.phase}>
    <div className="skyline-glider__menu">
      <SkylineMenus state={state} riders={RIDERS} acts={ACTS} onEvent={() => {}}
        crashNote={phase === 'crash' ? 'The gate shut before you got through. Boost (bottom right) as soon as it starts closing.' : null}
        summary={state.phase === 'result' ? SUMMARY : null}/>
      {state.phase === 'result' && !saveError && <p className="skyline-glider__notice" data-tone="good">Flight saved · +3 rings</p>}
      {phase === 'flights' && <p className="skyline-glider__notice" role="status">This saved flight uses an older course. Start begins a fresh flight; earned completion is kept.</p>}
    </div>
    <SkylineControlPanel controls={controls} onPress={() => {}}/>
  </main>;
}
