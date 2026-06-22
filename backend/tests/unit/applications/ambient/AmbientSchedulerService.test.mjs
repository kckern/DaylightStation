// backend/tests/unit/applications/ambient/AmbientSchedulerService.test.mjs
import { AmbientSchedulerService } from '#apps/ambient/AmbientSchedulerService.mjs';

const WIN = {
  key: 'am', name: 'am', days: [1], startMin: 420, endMin: 540,
  preset: 'impressionism', device: 'livingroom-tv',
};

function makeDeps({ idle = true } = {}) {
  const calls = { load: [], powerOff: [] };
  const powerOff = async () => { calls.powerOff.push(true); };
  return {
    calls,
    loadSchedule: async () => ({ windows: [WIN], warnings: [] }),
    tracker: { isPlaying: () => !idle },
    wakeAndLoadService: { execute: async (device, query) => { calls.load.push({ device, query }); } },
    deviceService: { get: () => ({ powerOff }) },
    stateStore: (() => {
      let s = { owned: null, handled: {} };
      return { load: async () => s, save: async (next) => { s = next; }, peek: () => s };
    })(),
    timeZone: 'America/Los_Angeles',
    logger: { info() {}, warn() {}, error() {} },
  };
}

// 2026-06-22T14:00:00Z === 07:00 Mon PDT (window start). 16:00Z === 09:00 (end).
const AT_START = new Date('2026-06-22T14:00:00Z');
const AT_END = new Date('2026-06-22T16:00:00Z');

describe('AmbientSchedulerService', () => {
  it('loads art at start when idle (after the first boot tick passes)', async () => {
    const deps = makeDeps({ idle: true });
    const svc = new AmbientSchedulerService(deps);
    // First tick is boot-catch-up: at start, marks handled without acting.
    const boot = await svc.runOnce(AT_START);
    expect(boot.actions[0].type).toBe('skip');
    expect(deps.calls.load).toEqual([]);
  });

  it('loads art at the start edge on a non-first tick when idle', async () => {
    const deps = makeDeps({ idle: true });
    const svc = new AmbientSchedulerService(deps);
    await svc.runOnce(new Date('2026-06-22T13:30:00Z')); // first tick, before start → nothing
    await svc.runOnce(AT_START);                          // start edge → load
    expect(deps.calls.load).toEqual([{ device: 'livingroom-tv', query: { display: 'art:impressionism' } }]);
    expect(deps.stateStore.peek().owned).toMatchObject({ key: 'am' });
  });

  it('powers off at end when ambient owns the session and idle', async () => {
    const deps = makeDeps({ idle: true });
    const svc = new AmbientSchedulerService(deps);
    await svc.runOnce(new Date('2026-06-22T13:30:00Z')); // first tick
    await svc.runOnce(AT_START);                          // load + own
    await svc.runOnce(AT_END);                            // end → power off
    expect(deps.calls.powerOff).toEqual([true]);
    expect(deps.stateStore.peek().owned).toBeNull();
  });

  it('drops ownership if the load throws (never powers off a TV it did not turn on)', async () => {
    const deps = makeDeps({ idle: true });
    deps.wakeAndLoadService.execute = async () => { throw new Error('load failed'); };
    const svc = new AmbientSchedulerService(deps);
    await svc.runOnce(new Date('2026-06-22T13:30:00Z'));
    await svc.runOnce(AT_START);
    expect(deps.stateStore.peek().owned).toBeNull();
  });
});
