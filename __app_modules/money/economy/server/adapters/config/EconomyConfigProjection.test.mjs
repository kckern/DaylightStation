import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect, vi } from 'vitest';
import { EconomyConfigProjection } from './EconomyConfigProjection.mjs';

// The catalog as the plan ships it.
const SHIPPED_CATALOG = `schema: household.economy/v1
mode: dry-run
rules_source: earn-rules
week_close:
  cron: "30 23 * * 0"
  convert:
    - { from: silver, to: gold, rate: 1 }
passes:
  early-pass:
    privileges: [piano.games]
    price: { silver: 0, gold: 0 }
    cap: { per: study-day, count: 1, across: all-passes }
    authorization: trust
    refund_within_ms: 60000
digest:
  cron: "0 18 * * *"
  zero_days_alert: 2
earn: {}
spend: {}
`;

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
    expect(projectionOver(doc).catalog()).toEqual({
      ...doc,
      passes: { 'early-pass': { ...doc.passes['early-pass'], refund_within_ms: 60000, max_active_ms: 1800000 } },
    });
  });

  it('gives each pass the 60 s refund window and the 30 minute active limit it leaves out, and keeps what it sets', () => {
    const catalog = projectionOver({
      passes: {
        bare: { privileges: ['piano.games'] },
        set: { privileges: ['arcade'], refund_within_ms: 120000, max_active_ms: 600000 },
        none: { privileges: ['tv'], refund_within_ms: 0 },
      },
    }).catalog();
    expect(catalog.passes.bare).toMatchObject({ refund_within_ms: 60000, max_active_ms: 1800000 });
    expect(catalog.passes.set).toMatchObject({ refund_within_ms: 120000, max_active_ms: 600000 });
    expect(catalog.passes.none).toMatchObject({ refund_within_ms: 0, max_active_ms: 1800000 });
  });

  it.each([['dry-run'], ['live'], ['off']])('accepts mode %s', (mode) => {
    expect(projectionOver({ mode }).catalog().mode).toBe(mode);
  });

  // A typo must never pay out: an unrecognised mode is off, and says so.
  // A bare `mode:` in YAML is null: someone wrote the key, so say it is unusable.
  it.each([['Live'], ['on'], [true], [1], [null]])('an unknown mode (%s) falls back to off with a warning', (mode) => {
    const logger = quietLogger();
    expect(projectionOver({ mode }, logger).catalog().mode).toBe('off');
    expect(logger.warn).toHaveBeenCalledWith('economy.catalog.unknown-mode', { mode, fallback: 'off' });
  });

  // Payouts read the catalog on every outcome and every sweep; one bad value
  // must not flood the log.
  it('warns once per distinct bad mode, and again when it changes', () => {
    let doc = { mode: 'Live' };
    const logger = quietLogger();
    const projection = new EconomyConfigProjection({ configService: { getHouseholdAppConfig: () => doc }, logger });
    projection.catalog();
    projection.catalog();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    doc = { mode: 'on' };
    projection.catalog();
    projection.catalog();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith('economy.catalog.unknown-mode', { mode: 'on', fallback: 'off' });
    // Fixed, then broken the same way again: that is news.
    doc = { mode: 'live' };
    projection.catalog();
    doc = { mode: 'on' };
    projection.catalog();
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('reads the shipped catalog file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-catalog-'));
    try {
      const file = path.join(dir, 'config.yml');
      fs.writeFileSync(file, SHIPPED_CATALOG);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      const catalog = projectionOver(doc).catalog();
      expect(catalog.mode).toBe('dry-run');
      expect(catalog.passes['early-pass'].refund_within_ms).toBe(60000);
      expect(catalog.week_close.convert[0].rate).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

describe('EconomyConfigProjection.users', () => {
  it('lists the household users that have a profile (so a wallet)', () => {
    const projection = new EconomyConfigProjection({
      configService: {
        getHouseholdUsers: () => ['kid-a', 'ghost', 'parent-a'],
        getUserProfile: (id) => (id === 'ghost' ? null : { id }),
      },
      logger: quietLogger(),
    });
    expect(projection.users()).toEqual(['kid-a', 'parent-a']);
  });
  it('no household users reads as none', () => {
    expect(new EconomyConfigProjection({ configService: {}, logger: quietLogger() }).users()).toEqual([]);
  });
});
