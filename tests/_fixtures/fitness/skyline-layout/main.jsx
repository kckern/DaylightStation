import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SkylineMenuLayout from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineMenuLayout.jsx';
import SkylineMenus from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineMenus.jsx';
import SkylineControlPanel from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineControlPanel.jsx';
import { MoreButton } from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineFlightHud.jsx';
import InvadersMenus, { InvadersTouchKeys } from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/InvadersMenus.jsx';
import InvadersResult from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/InvadersResult.jsx';
import InvadersReady from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/InvadersReady.jsx';
import { createSkylineControlState, describeSkylineControls, reduceSkylineControl } from '../../../../__app_modules/wellness/fitness/browser/lib/skylineGlider/controllerModel.js';
import { invadersControls, invadersAction, pressForMenuKey } from '../../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/invadersPanel.js';
import useMenuInput from '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/useMenuInput.js';
import { SETUP_METHODS } from '../../../../__app_modules/wellness/fitness/browser/lib/skylineInvaders/setupTest.js';
import { DaylightImagePath } from './stubs.js';
import '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineGlider/SkylineGlider.scss';
import '../../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/SkylineInvaders.scss';

const LONG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMN';
const names = ['Mountain Pass', 'Cloud Ridge', 'Ember Caves', 'Storm Front', 'Split Decision'];
const screens = {
  glider: ['identity', 'roster', 'flights', 'ready', 'countdown', 'menu', 'settings', 'crash', 'result', 'save-details', 'denied', 'loading', 'error'],
  invaders: ['who', 'roster', 'waves', 'method', 'sweep', 'locked', 'ready', 'paused', 'result', 'sound', 'loading', 'error'],
};
const tracker = { presence: () => ({ body: false }) };
let setScenario;
const actions = [];
window.__skylineLayout = {
  actions,
  setScenario(patch) { return setScenario(patch); },
};
function Fixture() {
  const [scenario, update] = useState({ game: 'glider', screen: 'flights', count: 14, selectedIndex: 0, longText: false, notice: '', saveStatus: 'saved', currentMethod: 'wheel', host: null, revision: 0, methodCursor: 0 });
  const [pending, setPending] = useState(null);
  setScenario = (patch) => {
    const next = { ...scenario, ...patch };
    if (!screens[next.game]?.includes(next.screen)) return Promise.reject(new Error(`Invalid fixture screen ${next.game}/${next.screen}`));
    return new Promise((resolve) => { setPending(() => resolve); update({ ...next, revision: scenario.revision + 1 }); });
  };
  useLayoutEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => { pending?.(); document.body.dataset.ready = 'true'; }));
  }, [scenario, pending]);
  const s = scenario;
  const riders = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, name: s.longText ? LONG : ['Robin', 'Sparrow', 'Dad', 'Other riders'][i], position: i + 1, avatarSrc: DaylightImagePath() }));
  const acts = Array.from({ length: s.count }, (_, i) => ({ id: `a${i}`, name: s.longText ? (i % 2 ? LONG : 'Mountain Pass Mountain Pass') : names[i % names.length], status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'open' : 'locked', stars: 2, introduces: [], detail: 'Shoot down 4 · 0:30' }));
  const chosen = acts[s.selectedIndex];
  const state = { ...createSkylineControlState({ riders, acts }), phase: s.screen, riderId: 'r0', actId: chosen?.id, saveStatus: s.saveStatus, accessReason: 'Finish today’s school work to unlock flying.', rosterIndex: 0, cadence: { rpm: 47 }, countdown: 3 };
  const view = { screen: s.screen, riders, person: riders[0], wave: chosen, count: acts.length, shooterName: riders[0].name, mat: true, canExit: true, saveStatus: s.saveStatus, controlsName: 'Steering wheel' };
  const record = { run: { status: 'failed', kills: 3, base_hp: 40, best_combo: 2, score: 12345, stars: 1, reward_rings: 3 } };
  const onPress = (position, gesture = 'single') => {
    actions.push({ type: 'press', value: position });
    if (s.game === 'glider') {
      const next = reduceSkylineControl(state, { type: 'PRESS', position, gesture }).state;
      update({ ...s, screen: next.phase, selectedIndex: Math.max(0, acts.findIndex(a => a.id === next.actId)) });
    } else {
      const action = invadersAction(view, position, gesture);
      if (action === 'method-next' || action === 'method-prev') update({ ...s, methodCursor: (s.methodCursor + (action === 'method-next' ? 1 : -1) + SETUP_METHODS.length) % SETUP_METHODS.length });
      if (action === 'method-choose') actions.push({ type: 'method', value: SETUP_METHODS[s.methodCursor] });
      if (action === 'wave-next' || action === 'wave-prev') update({ ...s, selectedIndex: (s.selectedIndex + (action === 'wave-next' ? 1 : -1) + acts.length) % acts.length });
    }
  };
  useMenuInput(s.game === 'invaders', (action) => { const hit = pressForMenuKey(s.screen, action); if (hit) onPress(...hit); });
  const menu = s.game === 'glider'
    ? <SkylineMenus state={state} riders={riders} acts={acts} onEvent={e => update({ ...s, selectedIndex: acts.findIndex(a => a.id === e.actId) })} crashNote="The gate shut before you got through. Boost (bottom right) as soon as it starts closing." summary={['Bells', 'Targets', 'Score', 'Bumps'].map(n => [n, 12])}/>
    : s.screen === 'result'
      ? <InvadersResult record={record} level={{ name: chosen?.name || 'First Light', pass: { kills: 4, base_hp_min: 50 } }} saveStatus={s.saveStatus}/>
      : s.screen === 'ready'
        ? <InvadersReady tracker={tracker} waveName={chosen?.name} gesture="wheel" poseStatus={{ state: 'detecting' }} onDone={() => {}}/>
        : <InvadersMenus screen={s.screen} riders={riders} everyone={riders} person={riders[0]} rows={acts} selectedId={chosen?.id} shooterName={riders[0].name} onSelect={id => update({ ...s, selectedIndex: acts.findIndex(a => a.id === id) })} onPick={id => actions.push({ type: 'person', value: id })} setup={{ current: s.currentMethod, cursor: s.methodCursor, method: 'wheel', camera: 'on', mat: true, leftS: 10 }} sound={{ level: 60 }} error="The waves could not be loaded. Try again."/>
  const controls = s.game === 'glider' ? <SkylineControlPanel controls={describeSkylineControls(state)} onPress={onPress}/> : <InvadersTouchKeys keys={invadersControls(view).filter(k => k.label || k.position > 4)} onPress={onPress}/>;
  const layout = <SkylineMenuLayout variant={s.game === 'glider' ? 'bike' : 'touch'} className={s.game === 'invaders' ? 'skyline-invaders__window' : ''} actions={controls} utility={<MoreButton onMore={() => actions.push({ type: 'more', value: true })}/>}>{menu}{s.notice && <p className="skyline-glider__notice" role="status">{s.notice}</p>}</SkylineMenuLayout>;
  return <div id="host" style={s.host ? { width: s.host.width, height: s.host.height } : undefined}>
    {s.game === 'glider' ? <main className="skyline-glider skyline-glider--controls skyline-menu-screen" data-control-phase={s.screen}>{layout}</main> : <main className="skyline-invaders" data-screen={s.screen}><section className="skyline-menu-screen skyline-invaders__menu">{layout}</section></main>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
