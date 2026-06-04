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
