import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessSimulationController } from './FitnessSimulationController.js';

function makeController() {
  const wsService = { send: vi.fn() };
  const session = {
    _deviceRouter: {
      getEquipmentCatalog: () => [
        { id: 'cycle_ace', name: 'Ace', cadence: 'cad1', eligible_users: ['felix', 'milo'] },
        { id: 'cycle_bee', name: 'Bee', cadence: 'cad2', eligible_users: ['kc'] }
      ]
    },
    getEquipmentRider: () => null,
    setEquipmentRider: vi.fn(),
    deviceManager: { getAllDevices: () => [] }
  };
  const ctrl = new FitnessSimulationController({
    wsService,
    getSession: () => session,
    zoneConfig: { zones: [{ id: 'active', min: 100 }] },
    getUsersConfig: () => ({})
  });
  return { ctrl, wsService, session };
}

describe('FitnessSimulationController — autoAssignRiders', () => {
  it('assigns distinct eligible riders to the first N bikes', () => {
    const { ctrl, session } = makeController();
    const out = ctrl.autoAssignRiders(2);
    expect(out).toEqual([
      { equipmentId: 'cycle_ace', userId: 'felix' },
      { equipmentId: 'cycle_bee', userId: 'kc' }
    ]);
    expect(session.setEquipmentRider).toHaveBeenCalledWith('cycle_ace', 'felix');
    expect(session.setEquipmentRider).toHaveBeenCalledWith('cycle_bee', 'kc');
  });

  it('skips a bike when its only eligible rider is already taken', () => {
    const { ctrl, session } = makeController();
    session._deviceRouter.getEquipmentCatalog = () => ([
      { id: 'cycle_ace', cadence: 'cad1', eligible_users: ['kc'] },
      { id: 'cycle_bee', cadence: 'cad2', eligible_users: ['kc'] }
    ]);
    const out = ctrl.autoAssignRiders(2);
    expect(out).toEqual([{ equipmentId: 'cycle_ace', userId: 'kc' }]);
  });
});

describe('FitnessSimulationController — RPM arc driver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('driveRpmArc sends cadence each second and stopRpmArc stops it', () => {
    const { ctrl, wsService } = makeController();
    ctrl.driveRpmArc('cycle_ace', { base: 80, amp: 0, periodS: 10 });
    vi.advanceTimersByTime(1000);
    const sendsAfter1s = wsService.send.mock.calls.length;
    expect(sendsAfter1s).toBeGreaterThan(0);

    ctrl.stopRpmArc('cycle_ace');
    wsService.send.mockClear();
    vi.advanceTimersByTime(3000);
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('stopAllRpmArcs clears every running arc', () => {
    const { ctrl, wsService } = makeController();
    ctrl.driveRpmArc('cycle_ace', { base: 70 });
    ctrl.driveRpmArc('cycle_bee', { base: 70 });
    ctrl.stopAllRpmArcs();
    wsService.send.mockClear();
    vi.advanceTimersByTime(3000);
    expect(wsService.send).not.toHaveBeenCalled();
  });
});

describe('FitnessSimulationController — ambient + stop', () => {
  it('startAmbientWorkout runs auto-session-all and a bike arc per equipment', () => {
    const { ctrl } = makeController();
    const sess = vi.spyOn(ctrl, 'startAutoSessionAll').mockReturnValue({ ok: true });
    const arc = vi.spyOn(ctrl, 'driveRpmArc').mockReturnValue({ ok: true });
    ctrl.startAmbientWorkout();
    expect(sess).toHaveBeenCalledTimes(1);
    expect(arc).toHaveBeenCalledWith('cycle_ace', expect.any(Object));
    expect(arc).toHaveBeenCalledWith('cycle_bee', expect.any(Object));
  });

  it('stopEverything stops HR, bikes, and all arcs', () => {
    const { ctrl } = makeController();
    const hr = vi.spyOn(ctrl, 'stopAll').mockReturnValue({ ok: true });
    const arcs = vi.spyOn(ctrl, 'stopAllRpmArcs').mockReturnValue({ ok: true });
    const eq = vi.spyOn(ctrl, 'stopEquipment').mockReturnValue({ ok: true });
    ctrl.stopEverything();
    expect(hr).toHaveBeenCalledTimes(1);
    expect(arcs).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('cycle_ace');
    expect(eq).toHaveBeenCalledWith('cycle_bee');
  });
});
