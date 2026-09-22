/**
 * What Health is told about a barcode capture. The adapter used to report any
 * saved UPC log as committed, which hid the two outcomes that need the person:
 * a refused code, and a capture held in Needs Review because no calories were
 * found.
 */
import { describe, it, expect, vi } from 'vitest';
import { WebNutribotAdapter } from './WebNutribotAdapter.mjs';

const scan = (routerResult) => {
  const inputRouter = { handleUpc: vi.fn(async () => routerResult) };
  return new WebNutribotAdapter({ inputRouter }).process({ type: 'barcode', content: '037000338369', userId: 'kc' });
};

describe('WebNutribotAdapter barcode outcomes', () => {
  it('a refused code is its own outcome, with the sentence to show', async () => {
    const out = await scan({ ok: false, code: 'NUTRIBOT_UPC_REJECTED', rejected: 'check-digit', message: "That isn't a food barcode (check digit)." });
    expect(out).toMatchObject({ committed: false, outcome: 'rejected-barcode', rejected: 'check-digit',
      message: "That isn't a food barcode (check digit)." });
  });

  it('a quarantined capture is not reported as committed', async () => {
    const out = await scan({ ok: true, committed: false, logId: 'L1', items: [],
      result: { success: true, nutrilogUuid: 'L1', committed: false, quarantined: true } });
    expect(out).toMatchObject({ committed: false, outcome: 'needs-review', logId: 'L1',
      message: 'Needs review — no calories found' });
  });

  it('an accepted capture is committed', async () => {
    const out = await scan({ ok: true, committed: true, logId: 'L2', items: [],
      result: { success: true, nutrilogUuid: 'L2', committed: true, quarantined: false } });
    expect(out).toMatchObject({ committed: true, outcome: 'committed' });
  });

  it('a product that is not found still reads as unknown food', async () => {
    const out = await scan({ ok: true, committed: false, logId: null, items: [],
      result: { success: false, error: 'Product not found', unknownUpc: true, upc: '037000338369' } });
    expect(out).toMatchObject({ committed: false, outcome: 'unknown-food', unknownUpc: true });
  });
});
