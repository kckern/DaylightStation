import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CalibrationConstants } from '#domains/health/services/CalibrationConstants.mjs';

const USER_ID = 'test-user';

// Deterministic "now" used across staleness tests.
const FAKE_NOW_ISO = '2024-07-01T12:00:00Z';

function makeDexa(date, { lean_tissue_lbs = 130, body_fat_percent = 22, ...rest } = {}) {
  return {
    date,
    source: 'bodyspec_dexa',
    device_type: 'DEXA',
    weight_lbs: 175,
    body_fat_percent,
    lean_tissue_lbs,
    fat_tissue_lbs: 38.5,
    ...rest,
  };
}

function makeStores({ latestDexa = null, weightData = {} } = {}) {
  return {
    healthScanStore: {
      getLatestScan: vi.fn(async () => latestDexa),
    },
    weightStore: {
      loadWeightData: vi.fn(async () => weightData),
    },
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FAKE_NOW_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CalibrationConstants', () => {
  it('load with no DEXA scan: corrections are identity, calibrationDate is null, flagIfStale always false', async () => {
    const { healthScanStore, weightStore } = makeStores({ latestDexa: null });
    const logger = makeLogger();
    const calibration = new CalibrationConstants({ healthScanStore, weightStore, logger });

    await calibration.load(USER_ID);

    expect(calibration.getCorrectedLean(120)).toBe(120);
    expect(calibration.getCorrectedBodyFat(25)).toBe(25);
    expect(calibration.getCalibrationDate()).toBeNull();
    expect(calibration.flagIfStale(0)).toBe(false);
    expect(calibration.flagIfStale(1000)).toBe(false);
  });

  it('load with DEXA but no adjacent BIA: offsets are 0, calibrationDate is set, warn logged', async () => {
    const dexa = makeDexa('2024-06-15');
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        // Outside the ±7 day window
        '2024-05-01': { lbs: 178, lbs_lean: 125, fat_percent: 25 },
        '2024-07-30': { lbs: 174, lbs_lean: 128, fat_percent: 24 },
        // Scale-only entries (no BIA fields) inside the window — should not count.
        '2024-06-14': { lbs: 175 },
      },
    });
    const logger = makeLogger();
    const calibration = new CalibrationConstants({ healthScanStore, weightStore, logger });

    await calibration.load(USER_ID);

    expect(calibration.getOffsets()).toEqual({ leanLbsOffset: 0, bodyFatPctOffset: 0 });
    expect(calibration.getCalibrationDate()).toBe('2024-06-15');
    expect(logger.warn).toHaveBeenCalled();
    // identity corrections because offsets are 0
    expect(calibration.getCorrectedLean(125)).toBe(125);
    expect(calibration.getCorrectedBodyFat(25)).toBe(25);
  });

  it('load with DEXA + 1 BIA reading within 7 days: offsets computed correctly', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-12': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });

    await calibration.load(USER_ID);

    const offsets = calibration.getOffsets();
    expect(offsets.leanLbsOffset).toBeCloseTo(132 - 128, 6); // 4 lbs
    expect(offsets.bodyFatPctOffset).toBeCloseTo(22 - 18, 6); // 4 pct
  });

  it('load with DEXA + multiple BIA readings: offsets use mean of those readings', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-12': { lbs: 175, lbs_lean: 126, fat_percent: 17 },
        '2024-06-14': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
        '2024-06-18': { lbs: 175, lbs_lean: 130, fat_percent: 19 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });

    await calibration.load(USER_ID);

    const meanLean = (126 + 128 + 130) / 3; // 128
    const meanBf = (17 + 18 + 19) / 3; // 18
    const offsets = calibration.getOffsets();
    expect(offsets.leanLbsOffset).toBeCloseTo(132 - meanLean, 6);
    expect(offsets.bodyFatPctOffset).toBeCloseTo(22 - meanBf, 6);
  });

  it('BIA readings outside ±7 days are excluded', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        // OUT: 8 days before
        '2024-06-07': { lbs: 175, lbs_lean: 100, fat_percent: 5 },
        // IN: exactly 7 days before (boundary inclusive)
        '2024-06-08': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
        // IN
        '2024-06-15': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
        // IN: exactly 7 days after
        '2024-06-22': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
        // OUT: 8 days after
        '2024-06-23': { lbs: 175, lbs_lean: 999, fat_percent: 99 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });

    await calibration.load(USER_ID);

    // Mean over 3 in-window entries (all 128 / 18); outliers excluded.
    const offsets = calibration.getOffsets();
    expect(offsets.leanLbsOffset).toBeCloseTo(132 - 128, 6);
    expect(offsets.bodyFatPctOffset).toBeCloseTo(22 - 18, 6);
  });

  it('getCorrectedLean adds leanOffset to rawBIA', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-14': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });
    await calibration.load(USER_ID);

    expect(calibration.getCorrectedLean(130)).toBeCloseTo(130 + 4, 6);
    expect(calibration.getCorrectedLean(125)).toBeCloseTo(125 + 4, 6);
  });

  it('getCorrectedBodyFat adds bfOffset to rawBIA', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-14': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });
    await calibration.load(USER_ID);

    expect(calibration.getCorrectedBodyFat(20)).toBeCloseTo(20 + 4, 6);
    expect(calibration.getCorrectedBodyFat(15)).toBeCloseTo(15 + 4, 6);
  });

  it('getStaleness returns days since DEXA date', async () => {
    // FAKE_NOW = 2024-07-01. DEXA date 2024-06-15 → 16 days.
    const dexa = makeDexa('2024-06-15');
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-14': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });
    await calibration.load(USER_ID);

    expect(calibration.getStaleness()).toBe(16);
  });

  it('getStaleness returns Infinity when no calibration', async () => {
    const { healthScanStore, weightStore } = makeStores({ latestDexa: null });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });
    await calibration.load(USER_ID);

    expect(calibration.getStaleness()).toBe(Infinity);
  });

  it('flagIfStale(180) returns true for 200-day-old DEXA, false for 150-day-old', async () => {
    // FAKE_NOW = 2024-07-01. 200 days back = 2023-12-14, 150 days back = 2024-02-02.
    const oldDexa = makeDexa('2023-12-14');
    const newishDexa = makeDexa('2024-02-02');

    {
      const { healthScanStore, weightStore } = makeStores({
        latestDexa: oldDexa,
        weightData: {},
      });
      const calibration = new CalibrationConstants({
        healthScanStore,
        weightStore,
        logger: makeLogger(),
      });
      await calibration.load(USER_ID);
      expect(calibration.flagIfStale(180)).toBe(true);
    }

    {
      const { healthScanStore, weightStore } = makeStores({
        latestDexa: newishDexa,
        weightData: {},
      });
      const calibration = new CalibrationConstants({
        healthScanStore,
        weightStore,
        logger: makeLogger(),
      });
      await calibration.load(USER_ID);
      expect(calibration.flagIfStale(180)).toBe(false);
    }
  });

  it('flagIfStale always returns false when no calibration (don\'t false-flag uncalibrated state)', async () => {
    const { healthScanStore, weightStore } = makeStores({ latestDexa: null });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });
    await calibration.load(USER_ID);

    expect(calibration.flagIfStale(0)).toBe(false);
    expect(calibration.flagIfStale(180)).toBe(false);
    expect(calibration.flagIfStale(99999)).toBe(false);
  });

  it('getOffsets returns the computed { leanLbsOffset, bodyFatPctOffset } for inspection', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-14': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });
    await calibration.load(USER_ID);

    const offsets = calibration.getOffsets();
    expect(offsets).toHaveProperty('leanLbsOffset');
    expect(offsets).toHaveProperty('bodyFatPctOffset');
    expect(offsets.leanLbsOffset).toBeCloseTo(4, 6);
    expect(offsets.bodyFatPctOffset).toBeCloseTo(4, 6);
  });

  it('load is idempotent — calling twice yields same offsets', async () => {
    const dexa = makeDexa('2024-06-15', { lean_tissue_lbs: 132, body_fat_percent: 22 });
    const { healthScanStore, weightStore } = makeStores({
      latestDexa: dexa,
      weightData: {
        '2024-06-14': { lbs: 175, lbs_lean: 128, fat_percent: 18 },
      },
    });
    const calibration = new CalibrationConstants({
      healthScanStore,
      weightStore,
      logger: makeLogger(),
    });

    await calibration.load(USER_ID);
    const first = calibration.getOffsets();
    await calibration.load(USER_ID);
    const second = calibration.getOffsets();

    expect(second).toEqual(first);
    expect(calibration.getCalibrationDate()).toBe('2024-06-15');
  });

  it('throws if healthScanStore or weightStore is missing', () => {
    expect(() => new CalibrationConstants({ weightStore: {} })).toThrow(/healthScanStore/);
    expect(() => new CalibrationConstants({ healthScanStore: {} })).toThrow(/weightStore/);
  });
});
