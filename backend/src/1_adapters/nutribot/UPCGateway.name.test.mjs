import { describe, it, expect, vi } from 'vitest';
import { UPCGateway } from './UPCGateway.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const offHit = product => ({ ok: true, data: { status: 1, product: { nutriments: {}, ...product } } });

describe('UPCGateway product names', () => {
  it('normalizes a shouting Open Food Facts name at ingest', async () => {
    const gw = new UPCGateway({ httpClient: { get: vi.fn(async () => offHit({ product_name: 'PEANUT BUTTER SPREAD' })) }, logger });
    expect((await gw.lookup('037600225250')).name).toBe('Peanut Butter Spread');
  });
  it('keeps the unknown-product fallback when the name is blank', async () => {
    const gw = new UPCGateway({ httpClient: { get: vi.fn(async () => offHit({ product_name: '   ' })) }, logger });
    expect((await gw.lookup('037600225250')).name).toBe('Unknown Product');
  });
  it('normalizes a Nutritionix name', async () => {
    const get = vi.fn(async url => url.includes('openfoodfacts')
      ? { ok: true, data: { status: 0 } }
      : { ok: true, data: { foods: [{ food_name: 'MACARONI AND CHEESE', nf_calories: 300 }] } });
    const gw = new UPCGateway({ httpClient: { get }, logger, nutritionix: { appId: 'a', appKey: 'k' } });
    expect((await gw.lookup('037600225250')).name).toBe('Macaroni and Cheese');
  });
});
