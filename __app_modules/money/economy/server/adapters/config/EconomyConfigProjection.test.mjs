import { describe, it, expect, vi } from 'vitest';
import { EconomyConfigProjection } from './EconomyConfigProjection.mjs';

const quietLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const projectionOver = (doc, logger = quietLogger()) => new EconomyConfigProjection({
  configService: { getHouseholdAppConfig: (_hid, app) => (app === 'economy' ? doc : null) },
  logger,
});

describe('EconomyConfigProjection.catalog', () => {
  it('a household with no economy config reads as off, with empty sections', () => {
    expect(projectionOver(null).catalog()).toEqual({
      mode: 'off',
      rules_source: 'earn-rules',
      week_close: { cron: null, convert: [] },
      passes: {},
      digest: { cron: null, zero_days_alert: null },
    });
  });

  it('fills the keys a partial config leaves out', () => {
    const catalog = projectionOver({ mode: 'dry-run', digest: { cron: '0 18 * * *' } }).catalog();
    expect(catalog.mode).toBe('dry-run');
    expect(catalog.digest).toEqual({ cron: '0 18 * * *', zero_days_alert: null });
    expect(catalog.week_close).toEqual({ cron: null, convert: [] });
    expect(catalog.passes).toEqual({});
  });

  it('returns the configured sections and the legacy earn/spend maps as written', () => {
    const doc = {
      schema: 'household.economy/v1',
      mode: 'live',
      rules_source: 'earn-rules',
      week_close: { cron: '30 23 * * 0', convert: [{ from: 'silver', to: 'gold', rate: 1 }] },
      passes: { 'early-pass': { privileges: ['piano.games'], authorization: 'trust' } },
      digest: { cron: '0 18 * * *', zero_days_alert: 2 },
      earn: { 'piano-lesson-complete': { reward: 5 } },
      spend: {},
    };
    expect(projectionOver(doc).catalog()).toEqual(doc);
  });

  it.each([['dry-run'], ['live'], ['off']])('accepts mode %s', (mode) => {
    expect(projectionOver({ mode }).catalog().mode).toBe(mode);
  });

  // A typo must never pay out: an unrecognised mode is off, and says so.
  it.each([['Live'], ['on'], [true], [1]])('an unknown mode (%s) falls back to off with a warning', (mode) => {
    const logger = quietLogger();
    expect(projectionOver({ mode }, logger).catalog().mode).toBe('off');
    expect(logger.warn).toHaveBeenCalledWith('economy.catalog.unknown-mode', { mode, fallback: 'off' });
  });

  it('ignores a section of the wrong type rather than handing it on', () => {
    const catalog = projectionOver({ week_close: { convert: 'silver->gold' }, passes: ['early-pass'], digest: 'daily' }).catalog();
    expect(catalog.week_close.convert).toEqual([]);
    expect(catalog.passes).toEqual({});
    expect(catalog.digest).toEqual({ cron: null, zero_days_alert: null });
  });

  // `system reload` swaps the served snapshot; a value cached at construction
  // would keep paying under the old mode.
  it('reads the current config on every call', () => {
    let doc = { mode: 'dry-run' };
    const projection = new EconomyConfigProjection({
      configService: { getHouseholdAppConfig: () => doc },
      logger: quietLogger(),
    });
    expect(projection.catalog().mode).toBe('dry-run');
    doc = { mode: 'live' };
    expect(projection.catalog().mode).toBe('live');
  });
});
