/**
 * A refused scan says so.
 *
 * `handleNutrition`'s `swallow` branch used to return without ever calling
 * `refreshPrompt` — the one path where nothing happened was the one path
 * that said nothing. The user got a scanner beep, no change on the Telegram
 * prompt, and no way to tell a dead feature from a bad code.
 *
 * @see backend/src/5_composition/modules/scanDispatch.mjs
 * @see backend/src/3_applications/nutribot/lib/routeNutribotScan.mjs
 */
import { describe, it, expect } from 'vitest';
import { swallowNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';
import { createScanDispatch } from '#composition/modules/scanDispatch.mjs';

/**
 * A minimal, valid `createScanDispatch` dependency bag, wired for the ONE
 * device this file's tests scan through. Mirrors the shape `makeDeps` builds
 * in `tests/unit/composition/scanDispatch.test.mjs` — that harness isn't
 * exported, so the construction is repeated here rather than imported, but
 * the fake shapes (and the "which fields DEP_CONTRACT requires" list) are the
 * same ones that file already proved correct.
 */
function makeDispatcher({ barcodeLogger, nutriscanEnabled }) {
  const noop = { debug() {}, info() {}, warn() {}, error() {} };
  const scanDispatch = createScanDispatch({
    schoolLifecycle: null,
    schoolCalcResultImporter: null,
    triggerDispatchService: { handleEvent: async () => ({ ok: true }) },
    relayInstances: {
      'nutribot-upc': { route: 'nutribot', scale_id: 'kitchen-food-scale' },
    },
    relayConfig: {},
    // `nutriscanEnabled: false` reproduces the 12:31 incident's precondition:
    // ApplyScanToComposition stays null, so every fridge-sheet code the
    // grammar claims dead-ends in the `swallow` branch under test.
    applyScanToComposition: nutriscanEnabled ? { execute: () => ({ handled: false }) } : null,
    getObservationService: () => ({ refreshPrompt: async () => {}, armCommitFor: () => {} }),
    getLogFoodFromUPC: () => ({ execute: async () => ({ ok: true }) }),
    nutribotIdentity: { defaultUserId: () => 'test-user', conversationIdFor: () => null },
    screenNames: [],
    logger: noop,
    barcodeLogger,
  });

  return (code) => scanDispatch.handleScan({
    source: 'barcode-relay', device: 'nutribot-upc', route: 'nutribot', code, ts: '2026-08-18 12:31:00',
  });
}

describe('repeated swallows stay observable', () => {
  it('never downgrades a refusal to debug', async () => {
    const levels = [];
    const barcodeLogger = {
      warn: (e) => levels.push(['warn', e]),
      debug: (e) => levels.push(['debug', e]),
      info: () => {},
      sampled: (e) => levels.push(['sampled', e]),
    };
    const dispatch = makeDispatcher({ barcodeLogger, nutriscanEnabled: false });
    await dispatch('dl:140');
    await dispatch('ct:60');
    await dispatch('dl:190');
    expect(levels.some(([lvl]) => lvl === 'debug')).toBe(false);
    expect(levels.filter(([lvl]) => lvl !== 'debug').length).toBe(3);
  });
});

describe('swallowNotice', () => {
  it('explains a disabled scanner in words a person at the fridge can act on', () => {
    expect(swallowNotice('nutriscan-disabled'))
      .toBe('scanning is off — the fridge sheet is not configured');
  });

  it('explains a scanner with no scale', () => {
    expect(swallowNotice('no-scale-id')).toBe('no scale for this scanner');
  });

  // An unknown reason must still produce SOMETHING. Silence is the bug.
  it('never returns empty for an unrecognised reason', () => {
    expect(swallowNotice('some-new-reason')).toBeTruthy();
  });
});
