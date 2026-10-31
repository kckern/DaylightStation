import { createSelectorInputRouter } from '../../lib/selectorInputRouter.js';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockCtx;
let apiFetch;
let worldFetch;
const { mockLog } = vi.hoisted(() => ({
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() },
}));
const gateMocks = vi.hoisted(() => ({
  localDev: true,
  entitlement: { items: [] },
  registerAdmin: vi.fn(),
  clearUnlock: vi.fn(),
}));
vi.mock("../../context/FitnessContext.jsx", () => ({ useFitnessContext: () => mockCtx }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => mockLog }) }));
vi.mock('@/lib/kioskEnv.js', () => ({
  isLocalDevHost: () => gateMocks.localDev,
  isKioskEnv: () => !gateMocks.localDev,
}));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => {
    if (gateMocks.entitlement instanceof Error) throw gateMocks.entitlement;
    return gateMocks.entitlement;
  }),
  DaylightMediaPath: (path) => path,
  DaylightImagePath: (path) => path,
}));
vi.mock("../../identity/useIdentity.js", () => ({
  useIdentity: () => ({
    registerAdmin: gateMocks.registerAdmin,
    clearUnlock: gateMocks.clearUnlock,
    unlockState: 'idle',
    unlockedUser: null,
  }),
}));
import SkylineGlider from "./SkylineGlider.jsx";
import { FlightScene, RpmGauge } from "./SkylineGlider.jsx";

const course = { schema: 'skyline-glider-course/v1', id: 'mountain-pass', version: 1, name: 'Mountain Pass', description: 'A five minute alpine flight.', duration_s: 300, motion: { filter_s: .75, deadband_rpm: 2, response_s: 1.5, max_climb_rate: .3, max_descent_rate: .22, coast_s: 1, disconnect_grace_s: .75 }, rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 }, segments: [
  { id: 'open', type: 'open', start_s: 0, end_s: 300 },
  { id: 'bells', type: 'collectible-path', start_s: 2, end_s: 10, collectibles: [{ id: 'bell', at_s: 7, altitude: .5 }] },
  { id: 'hill', type: 'lower-terrain', start_s: 5, end_s: 12, top: .62 },
  { id: 'ceiling', type: 'upper-terrain', start_s: 13, end_s: 18, bottom: .38 },
  { id: 'tunnel', type: 'corridor', start_s: 19, end_s: 26, ceiling: .28, floor: .66 },
  { id: 'finish', type: 'finish', start_s: 300 },
] };

const flightState = {
  courseTime: 8,
  altitude: .5,
  targetAltitude: .35,
  rawRpm: 64,
  filteredRpm: 60,
  verticalRate: -.2,
  calibration: { lowRpm: 30, highRpm: 100 },
  invincibleRemaining: 1,
  phase: 'playing',
};

const skylineEntitlement = (decision = 'denied', basisState = 'unsatisfied', riderId = 'dad') => ({
  items: [{
    capabilityId: 'fitness.skyline-glider', gateId: 'school.day-complete', decision, basisState,
    degraded: false, subject: { kind: 'learner', id: riderId },
    period: { kind: 'interval', id: 'school-day:2026-10-07', startsAt: 0, endsAt: Date.now() + 86_400_000 },
    validFrom: 0, validUntil: Date.now() + 86_400_000,
  }],
});

beforeEach(() => {
  localStorage.clear();
  mockLog.info.mockClear();
  mockLog.debug.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
  mockLog.sampled.mockClear();
  gateMocks.localDev = true;
  gateMocks.entitlement = { items: [] };
  gateMocks.registerAdmin.mockReset();
  gateMocks.registerAdmin.mockResolvedValue({ matched: false, reason: 'denied' });
  gateMocks.clearUnlock.mockReset();
  const appListeners = new Map();
  mockCtx = { equipment: [{ id: 'bike', name: 'Bike', cadence: 7, rpm: { min: 30, max: 100 } }], fitnessSessionInstance: { sessionId: 'fs-test', treasureBox: { awardBonus: vi.fn() }, getEquipmentRider: () => 'dad', getEquipmentCadence: () => ({ rpm: 60, connected: true, ts: Date.now() + 1 }) }, getDisplayName: () => ({ displayName: 'Dad', source: 'userProfile', preferredGroupLabel: false }), getUserByName: () => ({ id: 'dad', schoolLearner: true }), subscribeToAppEvent: (type, callback) => { appListeners.set(type, callback); return () => appListeners.delete(type); }, __emitAppEvent: (type, payload) => appListeners.get(type)?.({ type, payload, timestamp: Date.now() }), setGovernanceSuspended: vi.fn() };
  // World-map reads go to their own mock so run-save assertions keep exact call order.
  apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ courses: [course] }) }));
  worldFetch = vi.fn(async () => ({ ok: true, json: async () => ({ zones: [{ id: 'alpine', name: 'Alpine', acts: [{ id: 'mountain-pass', name: 'Mountain Pass', act: 1, status: 'open' }] }], next: 'mountain-pass' }) }));
  global.fetch = vi.fn((url, options) => (String(url).includes('/skyline-glider/world') ? worldFetch(url, options) : apiFetch(url, options)));
});


afterEach(()=>vi.useRealTimers());
let rpm=65;
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve()});
const press=async(position,gesture='single')=>{await act(async()=>{const action=position+'_'+gesture;mockCtx.selectorInputRouter.route({selectorId:'pad',equipmentId:'bike',action,userId:mockCtx.riderSelectors[0].buttons[action]})})};
const advance=async ms=>{await act(async()=>vi.advanceTimersByTime(ms));await flush()};
async function mount(options={}){
 vi.useFakeTimers();rpm=65;
 mockCtx.selectorInputRouter=createSelectorInputRouter();
 mockCtx.riderSelectors=[{id:'pad',equipment:'bike',buttons:{'1_single':'dad','2_single':'other','2_long':'adult'}}];
 mockCtx.users=[{id:'dad',name:'Dad'},{id:'other',name:'Other'},{id:'adult',name:'Adult'}];
 mockCtx.fitnessSessionInstance.setEquipmentRider=vi.fn();
 mockCtx.fitnessSessionInstance.getEquipmentCadence=()=>({rpm,connected:true,ts:Date.now()});
 if(options.nonSchoolAdult)mockCtx.getUserByName=id=>({id,schoolLearner:id!=='adult'});
 const duration=options.duration||100;
 apiFetch.mockResolvedValue({ok:true,json:async()=>({courses:[{...course,duration_s:duration,rules:{...course.rules,weapons:{enabled:!options.noWeapons}},segments:[{id:'finish',type:'finish',start_s:duration}]},...(options.extraCourses||[])]})});
 render(<SkylineGlider/>);await flush();await press(1);await flush();
}
async function launch(){await press(4);await advance(4250);await advance(100)}
describe('complete bike lifecycle',()=>{
 it('finishes saving a legacy terminal record before pedaling or creating another run',async()=>{
  const record={schema:'skyline-glider-run/v1',run:{id:'old-run',status:'abandoned',course_id:'mountain-pass',course_version:1,started_at:'2026-10-29T10:00:00Z',ended_at:'2026-10-29T10:01:00Z',duration_s:60,reward_rings:0},rider:{user_id:'dad'},collectibles:[]};
  localStorage.setItem('fitness:skyline-glider:dad:mountain-pass',JSON.stringify({schema:'skyline-glider-checkpoint/v3',lifecycle:'pending_terminal',identity:{runId:'old-run',startedAt:record.run.started_at},state:{...flightState,phase:'completed',collectedIds:[],calibration:{lowRpm:30,highRpm:100}},terminalRecord:record}));
  await mount();await press(4);await flush();
  const writes=apiFetch.mock.calls.filter(([u,o])=>u.endsWith('/runs')&&o?.method==='POST');
  expect(writes).toHaveLength(1);expect(JSON.parse(writes[0][1].body).record).toEqual(record);
  expect(mockLog.info.mock.calls.some(([n])=>n==='skyline_glider.flight.started')).toBe(false);
  expect(screen.getByText(/Flight saved/)).toBeVisible();
 });
 it('keeps a failed terminal record available even when local storage is unavailable',async()=>{
  await mount();await launch();await press(4,'long');
  const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage denied')});
  apiFetch.mockResolvedValue({ok:false,status:503});
  try{await press(3);await flush();expect(screen.getByTestId('skyline-glider-result')).toHaveTextContent('Save failed');expect(screen.getByRole('button',{name:/Retry save/})).toBeEnabled()}finally{storage.mockRestore()}
 });
 it('starts the explicitly selected next act instead of retaining the finished course lock',async()=>{
  const next={...course,id:'cloud-ridge',name:'Cloud Ridge',duration_s:100,segments:[{id:'finish',type:'finish',start_s:100}]};
  await mount({duration:2,extraCourses:[next]});await launch();await advance(2500);await flush();
  await press(2);await advance(4250);await advance(100);
  const starts=mockLog.info.mock.calls.filter(([n])=>n==='skyline_glider.flight.started');
  expect(starts.at(-1)[1].courseId).toBe('cloud-ridge');
 });
 it('allows an explicit non-school parent and keeps denied children gated',async()=>{
  gateMocks.localDev=false;gateMocks.entitlement=skylineEntitlement('denied');
  await mount({nonSchoolAdult:true});
  expect(screen.getByTestId('skyline-glider-school-lock')).toBeVisible();
  await press(4);await press(2,'long');await flush();
  expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('flights');
  expect(mockCtx.fitnessSessionInstance.setEquipmentRider).toHaveBeenLastCalledWith('bike','adult');
 });
 it('requests admin approval from the panel and keeps the selected child attribution',async()=>{
  gateMocks.localDev=false;gateMocks.entitlement=skylineEntitlement('denied');
  gateMocks.registerAdmin.mockResolvedValue({matched:true,userId:'supervisor'});
  await mount();await press(1);await flush();
  expect(gateMocks.registerAdmin).toHaveBeenCalledWith('skyline_glider');
  expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('flights');
  expect(mockCtx.fitnessSessionInstance.setEquipmentRider).toHaveBeenCalledExactlyOnceWith('bike','dad');
 });
 it('completes a flight once and gates replay behind the saved result',async()=>{
  await mount({duration:2});await launch();await advance(2500);await flush();
  expect(screen.getByTestId('skyline-glider-result')).toHaveTextContent('Flight saved');
  expect(mockCtx.fitnessSessionInstance.treasureBox.awardBonus).toHaveBeenCalledOnce();
  const writes=apiFetch.mock.calls.filter(([u,o])=>u.endsWith('/runs')&&o?.method==='POST');
  expect(writes).toHaveLength(1);expect(JSON.parse(writes[0][1].body).record.run.status).toBe('completed');
  await press(2);expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('flights');
 });
 it('disables combat in the confidence flight while keeping menu access',async()=>{
  await mount({noWeapons:true});await launch();await press(1);await press(2);await press(3);await advance(100);
  expect(screen.queryByTestId('skyline-glider-bombs')).toBeNull();
  await press(4,'long');expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('menu');
 });
 it('commits a zero stall and waits for a physical checkpoint retry',async()=>{
  await mount();await launch();rpm=0;await advance(100);rpm=130;await advance(3000);
  expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('crash');
  await advance(5000);expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('crash');
  await press(1);expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('ready');
  await advance(4250);await advance(100);expect(screen.getByTestId('skyline-glider-flight')).toBeVisible();
 });
 it('retains an identical terminal record through save failure and duplicate retry presses',async()=>{
  await mount();await launch();await press(4,'long');
  apiFetch.mockResolvedValue({ok:false,status:503});await press(3);await flush();
  expect(screen.getByTestId('skyline-glider-result')).toHaveTextContent('Save failed');
  const writes=()=>apiFetch.mock.calls.filter(([url,options])=>options?.method==='POST'&&url.endsWith('/runs'));
  const first=writes()[0][1].body;
  await press(4);expect(writes()).toHaveLength(1);
  apiFetch.mockResolvedValue({ok:true,json:async()=>({created:false})});await press(1);await flush();
  expect(writes()).toHaveLength(2);expect(writes()[1][1].body).toBe(first);
  expect(screen.getByTestId('skyline-glider-result')).toHaveTextContent('Flight saved');
 });
 it('freezes menu time and resumes the same ammo and run',async()=>{
  await mount();await launch();await press(2);await advance(100);
  const starts=()=>mockLog.info.mock.calls.filter(([n])=>n==='skyline_glider.flight.started');
  await press(4,'long');const before=starts().length;await advance(5000);
  await press(1);await advance(4250);await advance(100);
  expect(screen.getByTestId('skyline-glider-bombs')).toHaveTextContent('4');expect(starts()).toHaveLength(before);
 });
 it('offers other riders without double press and commits only explicit selections',async()=>{
  await mount();await press(3);await press(4,'long');
  expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('roster');
  await press(2);await press(4);
  expect(mockCtx.fitnessSessionInstance.setEquipmentRider).toHaveBeenLastCalledWith('bike','other');
 });
 it('never routes another bike into this flight',async()=>{
  await mount();await launch();
  let consumed;act(()=>{consumed=mockCtx.selectorInputRouter.route({selectorId:'pad2',equipmentId:'bike2',action:'2_single',userId:'other'})});
  expect(consumed).toBe(false);expect(screen.getByTestId('skyline-glider-bombs')).toHaveTextContent('5');
 });
 it('requires explicit Start and steady pedaling without allocating a run while waiting',async()=>{
  await mount();expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('flights');
  rpm=0;await press(4);await advance(5000);
  expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('ready');
  expect(mockLog.info.mock.calls.some(([name])=>name==='skyline_glider.flight.started')).toBe(false);
  rpm=65;await advance(4250);await advance(100);expect(screen.getByTestId('skyline-glider-flight')).toHaveAttribute('data-rider-id','dad');
 });
 it('uses all four physical actions without changing rider assignment',async()=>{
  await mount();await launch();await press(1);await advance(50);
  expect(screen.getByTestId('skyline-glider-bombs')).toHaveTextContent('5');
  await press(2);await press(3);await press(4);await advance(100);
  expect(screen.getByTestId('skyline-glider-bombs')).toHaveTextContent('4');
  expect(mockCtx.fitnessSessionInstance.setEquipmentRider).toHaveBeenCalledExactlyOnceWith('bike','dad');
  expect(screen.getByTestId('skyline-glider-flight')).toHaveAttribute('data-rider-id','dad');
 });
 it('opens a seated menu, saves abandonment once, and replays the same rider',async()=>{
  await mount();await launch();await press(4,'long');
  expect(screen.getByTestId('skyline-glider-lobby').dataset.controlPhase).toBe('menu');
  apiFetch.mockResolvedValue({ok:true,json:async()=>({created:true})});
  await press(3);await flush();
  expect(screen.getByTestId('skyline-glider-result')).toHaveTextContent('Flight saved');
  const writes=()=>apiFetch.mock.calls.filter(([url,options])=>options?.method==='POST'&&url.endsWith('/runs'));
  expect(writes()).toHaveLength(1);
  await press(1);await advance(4250);await advance(100);
  expect(screen.getByTestId('skyline-glider-flight')).toHaveAttribute('data-rider-id','dad');
 });
});

