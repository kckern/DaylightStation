import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// Mock the Logger to prevent side effects
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

/**
 * FitnessSession.getEquipmentCadence(equipmentId) — unit tests.
 *
 * Data path:
 *   MQTT ANT+ payload -> DeviceEventRouter('ant') -> DeviceManager.updateDevice
 *     -> Device.cadence (latest RPM) + Device.lastSignificantActivity
 *   Equipment catalog maps equipmentId -> cadence (ANT+ device id) in config.
 *   Accessor resolves equipment entry -> cadence device id -> device sample
 *   and checks staleness against FITNESS_TIMEOUTS.rpmZero.
 *
 * Return contract:
 *   { rpm: number, connected: boolean }
 *     - unknown equipmentId                            -> { rpm: 0, connected: false }
 *     - equipment in catalog but no device reading yet -> { rpm: 0, connected: false }
 *     - fresh device reading                            -> { rpm, connected: true }
 *     - reading older than FITNESS_TIMEOUTS.rpmZero    -> { rpm: 0, connected: false }
 */

let FitnessSession;
let setFitnessTimeouts;
let getFitnessTimeouts;

beforeAll(async () => {
  const mod = await import('#frontend/hooks/fitness/FitnessSession.js');
  FitnessSession = mod.FitnessSession;
  setFitnessTimeouts = mod.setFitnessTimeouts;
  getFitnessTimeouts = mod.getFitnessTimeouts;
});

describe('FitnessSession.getEquipmentCadence', () => {
  let session;
  let originalRpmZero;

  beforeEach(() => {
    // Preserve and restore the module-level rpmZero timeout across tests.
    originalRpmZero = getFitnessTimeouts().rpmZero;
    setFitnessTimeouts({ rpmZero: originalRpmZero });

    session = new FitnessSession();
    // Configure a bike equipment whose cadence sensor is ANT+ device 49904.
    session.setEquipmentCatalog([
      { id: 'bike-1', name: 'Bike 1', type: 'bike', cadence: 49904 },
      { id: 'bike-2', name: 'Bike 2', type: 'bike', cadence: 49905 }
    ]);
  });

  afterEach(() => {
    setFitnessTimeouts({ rpmZero: originalRpmZero });
  });

  it('returns { rpm, connected } for a configured equipment id with a fresh reading', () => {
    // Simulate an ANT+ cadence packet arriving for device 49904
    session.deviceManager.updateDevice('49904', 'bike_cadence', {
      CalculatedCadence: 82,
      timestamp: Date.now()
    });

    const result = session.getEquipmentCadence('bike-1');

    expect(result).toEqual({ rpm: 82, connected: true });
  });

  it('returns { rpm: 0, connected: false } for missing equipment', () => {
    expect(session.getEquipmentCadence('does-not-exist')).toEqual({
      rpm: 0,
      connected: false
    });
  });

  it('returns { rpm: 0, connected: false } when equipment exists but no cadence reading yet', () => {
    // bike-2 has an entry in the catalog but no device has posted a sample.
    expect(session.getEquipmentCadence('bike-2')).toEqual({
      rpm: 0,
      connected: false
    });
  });

  it('returns { rpm: 0, connected: false } when the reading is older than FITNESS_TIMEOUTS.rpmZero', () => {
    // Push a reading, then forcibly age it beyond the rpmZero window.
    session.deviceManager.updateDevice('49904', 'bike_cadence', {
      CalculatedCadence: 75,
      timestamp: Date.now()
    });
    const device = session.deviceManager.getDevice('49904');
    const { rpmZero } = getFitnessTimeouts();
    // Push the "last significant activity" far enough into the past.
    device.lastSignificantActivity = Date.now() - (rpmZero + 1000);
    // Ensure lastSeen also pre-dates any grace buffer.
    device.lastSeen = device.lastSignificantActivity;

    expect(session.getEquipmentCadence('bike-1')).toEqual({
      rpm: 0,
      connected: false
    });
  });

  it('handles null/undefined equipmentId by returning disconnected', () => {
    expect(session.getEquipmentCadence(null)).toEqual({ rpm: 0, connected: false });
    expect(session.getEquipmentCadence(undefined)).toEqual({ rpm: 0, connected: false });
    expect(session.getEquipmentCadence('')).toEqual({ rpm: 0, connected: false });
  });

  it('coerces numeric equipmentId inputs to strings for lookup', () => {
    session.setEquipmentCatalog([
      { id: 100, name: 'Numeric Bike', type: 'bike', cadence: 77777 }
    ]);
    session.deviceManager.updateDevice('77777', 'bike_cadence', {
      CalculatedCadence: 64,
      timestamp: Date.now()
    });

    expect(session.getEquipmentCadence(100)).toEqual({ rpm: 64, connected: true });
    expect(session.getEquipmentCadence('100')).toEqual({ rpm: 64, connected: true });
  });
});
