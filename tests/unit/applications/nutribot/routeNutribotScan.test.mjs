/**
 * Three-way scan routing — the DECISION, extracted from the composition root.
 *
 * `scanRoutingOrder.test.mjs` pins the `handled` contract of the use case, but
 * it cannot see the branch in `app.mjs` that consumes it. That blind spot hid a
 * real defect: when `validateScanConfig` threw at boot, `applyScanToComposition`
 * stayed null, the branch took neither arm, and `dl:4` fell through to the UPC
 * lookup — a fridge-sheet code sent to a product database. These tests cover the
 * decision itself so the disabled case is no longer invisible.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeNutribotScan, nutriscanRefusalNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

const applyStub = (outcome) => ({ execute: vi.fn(() => outcome) });

describe('routeNutribotScan — nutriscan available', () => {
  it('routes a claimed scan to nutriscan and hands back the outcome', () => {
    const outcome = { handled: true, ok: true, kind: 'density', level: 4 };
    const apply = applyStub(outcome);
    const res = routeNutribotScan({ scaleId: 'kitchen', code: 'dl:4', apply });
    expect(res).toEqual({ action: 'nutriscan', outcome });
    expect(apply.execute).toHaveBeenCalledWith({ scaleId: 'kitchen', code: 'dl:4' });
  });

  it('routes a REFUSED scan to nutriscan too — a refusal is still a claim', () => {
    const outcome = { handled: true, ok: false, kind: 'container', error: 'UNKNOWN_CONTAINER', id: 'teapot' };
    const res = routeNutribotScan({ scaleId: 'kitchen', code: 'ct:teapot', apply: applyStub(outcome) });
    expect(res.action).toBe('nutriscan');
    expect(res.action).not.toBe('upc');
    expect(res.outcome.ok).toBe(false);
  });

  it('falls through to UPC for a code the grammar does not claim', () => {
    const res = routeNutribotScan({ scaleId: 'kitchen', code: '012345678905', apply: applyStub({ handled: false }) });
    expect(res).toEqual({ action: 'upc' });
  });
});

describe('routeNutribotScan — nutriscan DISABLED (bad config at boot)', () => {
  it('SWALLOWS a fridge-sheet code instead of looking it up as a UPC', () => {
    for (const code of ['dl:4', 'ct:mug', 'rs:clear']) {
      const res = routeNutribotScan({ scaleId: 'kitchen', code, apply: null });
      expect(res.action).toBe('swallow');
      expect(res.action).not.toBe('upc');
      expect(res.reason).toBe('nutriscan-disabled');
    }
  });

  it('still routes a real product barcode to the UPC lookup', () => {
    expect(routeNutribotScan({ scaleId: 'kitchen', code: '012345678905', apply: null })).toEqual({ action: 'upc' });
    expect(routeNutribotScan({ scaleId: 'kitchen', code: '4006381333931', apply: null }).action).toBe('upc');
  });
});

describe('routeNutribotScan — reader with no scale_id (a valid config)', () => {
  it('sends product scans straight to UPC without complaint', () => {
    const apply = applyStub({ handled: false });
    const res = routeNutribotScan({ scaleId: null, code: '012345678905', apply });
    expect(res).toEqual({ action: 'upc' });
    expect(apply.execute).not.toHaveBeenCalled(); // nothing to apply it to
  });

  it('swallows a fridge-sheet code — there is no scale to apply it to', () => {
    const res = routeNutribotScan({ scaleId: null, code: 'dl:4', apply: applyStub({ handled: false }) });
    expect(res.action).toBe('swallow');
    expect(res.reason).toBe('no-scale-id');
  });
});

describe('nutriscanRefusalNotice', () => {
  it('names the container that was refused', () => {
    const notice = nutriscanRefusalNotice({ kind: 'container', error: 'UNKNOWN_CONTAINER', id: 'teapot' });
    expect(notice).toContain('teapot');
    expect(notice).toMatch(/not tared/);
  });

  it('names the density level that was refused', () => {
    const notice = nutriscanRefusalNotice({ kind: 'density', error: 'UNKNOWN_DENSITY_LEVEL', level: 7 });
    expect(notice).toContain('7');
  });

  it('degrades to something readable for an unrecognised refusal', () => {
    expect(typeof nutriscanRefusalNotice({ kind: 'container', error: 'WAT' })).toBe('string');
  });
});
