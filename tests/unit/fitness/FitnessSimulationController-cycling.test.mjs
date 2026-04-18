import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { FitnessSimulationController } = await import('#frontend/modules/Fitness/nav/FitnessSimulationController.js');

describe('FitnessSimulationController cycling', () => {
  let controller, sentMessages, mockSession;

  beforeEach(() => {
    sentMessages = [];
    const wsService = { send: (m) => sentMessages.push(m) };
    mockSession = {
      _deviceRouter: {
        getEquipmentCatalog: () => [
          { id: 'cycle_ace', type: 'stationary_bike', cadence: 49904, eligible_users: ['felix', 'milo'] },
          { id: 'tricycle', type: 'stationary_bike', cadence: 7153, eligible_users: ['niels'] },
          // No cadence — should be filtered
          { id: 'treadmill', type: 'treadmill', eligible_users: ['felix'] }
        ]
      },
      governanceEngine: {
        triggerChallenge: jest.fn().mockReturnValue({ success: true, challengeId: 'cyc_1' }),
        swapCycleRider: jest.fn().mockReturnValue({ success: true }),
        policies: [{
          id: 'default',
          challenges: [{
            id: 'ch0',
            selections: [
              { id: 'default_0_0', type: 'cycle', label: 'Sprint', equipment: 'cycle_ace' },
              { id: 'default_0_1', type: 'zone', zone: 'warm' }
            ]
          }]
        }]
      }
    };

    controller = new FitnessSimulationController({
      wsService,
      getSession: () => mockSession,
      zoneConfig: { zones: [
        { id: 'cool', min: 0 },
        { id: 'active', min: 100 },
        { id: 'warm', min: 120 },
        { id: 'hot', min: 140 },
        { id: 'fire', min: 160 }
      ] },
      getUsersConfig: () => ({})
    });
  });

  it('getEquipment returns entries with cadence devices', () => {
    const list = controller.getEquipment();
    expect(list.length).toBe(2);
    expect(list[0].equipmentId).toBe('cycle_ace');
    expect(list[0].cadenceDeviceId).toBe('49904');
    expect(list[0].eligibleUsers).toEqual(['felix', 'milo']);
    expect(list[0].currentRpm).toBeNull();
    expect(list[0].isActive).toBe(false);
  });

  it('setRpm sends ANT+ cadence message', () => {
    const result = controller.setRpm('cycle_ace', 75);
    expect(result.ok).toBe(true);
    expect(result.rpm).toBe(75);
    expect(sentMessages.length).toBe(1);
    const msg = sentMessages[0];
    expect(msg.profile).toBe('CAD');
    expect(msg.deviceId).toBe('49904');
    expect(msg.data.CalculatedCadence).toBe(75);
  });

  it('setRpm updates getEquipment currentRpm and isActive', () => {
    controller.setRpm('cycle_ace', 65);
    const list = controller.getEquipment();
    const ace = list.find(e => e.equipmentId === 'cycle_ace');
    expect(ace.currentRpm).toBe(65);
    expect(ace.isActive).toBe(true);
  });

  it('setRpm rejects invalid values', () => {
    expect(controller.setRpm('cycle_ace', -5).ok).toBe(false);
    expect(controller.setRpm('cycle_ace', 500).ok).toBe(false);
  });

  it('setRpm unknown equipment returns error', () => {
    const result = controller.setRpm('unknown_bike', 50);
    expect(result.ok).toBe(false);
  });

  it('stopEquipment clears lastRpm', () => {
    controller.setRpm('cycle_ace', 70);
    controller.stopEquipment('cycle_ace');
    const list = controller.getEquipment();
    const ace = list.find(e => e.equipmentId === 'cycle_ace');
    expect(ace.currentRpm).toBeNull();
  });

  it('triggerCycleChallenge delegates to engine', () => {
    const result = controller.triggerCycleChallenge({ selectionId: 'default_0_0', riderId: 'felix' });
    expect(mockSession.governanceEngine.triggerChallenge).toHaveBeenCalledWith({
      type: 'cycle', selectionId: 'default_0_0', riderId: 'felix'
    });
    expect(result.success).toBe(true);
  });

  it('swapCycleRider delegates to engine', () => {
    const result = controller.swapCycleRider('milo', { force: true });
    expect(mockSession.governanceEngine.swapCycleRider).toHaveBeenCalledWith('milo', { force: true });
    expect(result.success).toBe(true);
  });

  it('listCycleSelections returns only type=cycle selections', () => {
    const list = controller.listCycleSelections();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: 'default_0_0', label: 'Sprint', equipment: 'cycle_ace' });
  });
});
