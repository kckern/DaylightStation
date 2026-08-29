import { describe, expect, it, vi } from 'vitest';
import { createGratitudeRouter } from './gratitude.mjs';

function printHandler(router) {
  return router.stack.find((layer) => layer.route?.path === '/card/print{/:location}')
    .route.stack.at(-1).handle;
}
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const base = {
  gratitudeService: { markAsPrinted: vi.fn() },
  gratitudeHouseholdService: { generateTimestamp: () => 'stamp', getDefaultHouseholdId: () => 'default' },
  gratitudeEvents: { customItem: vi.fn() },
};

describe('gratitude card API translation', () => {
  it('preserves printer-not-found status/body and resolves before rendering', async () => {
    const createGratitudeCardCanvas = vi.fn();
    const router = createGratitudeRouter({
      ...base, createGratitudeCardCanvas,
      cardPrintService: { prepare: () => ({ kind: 'printer_not_found', message: 'Unknown printer: attic' }) },
    });
    const res = response();
    await printHandler(router)({ params: { location: 'attic' }, query: {} }, res, (error) => { if (error) throw error; });
    expect(res).toMatchObject({ statusCode: 404, body: { error: 'Unknown printer: attic', success: false } });
    expect(createGratitudeCardCanvas).not.toHaveBeenCalled();
  });

  it('preserves the successful response and stored mark shape', async () => {
    const markAsPrinted = vi.fn();
    const router = createGratitudeRouter({
      ...base,
      gratitudeService: { markAsPrinted },
      createGratitudeCardCanvas: async () => ({
        canvas: { toBuffer: () => Buffer.from('png') }, width: 10, height: 20,
        selectedIds: { gratitude: ['g1'], hopes: ['h1'] },
      }),
      cardPrintService: { prepare: () => ({ kind: 'ready', print: async () => ({ kind: 'completed', success: true }) }) },
    });
    const res = response();
    await printHandler(router)({ params: {}, query: {} }, res, (error) => { if (error) throw error; });
    expect(res.body).toMatchObject({
      success: true, message: 'Gratitude card printed successfully',
      printed: { gratitude: ['g1'], hopes: ['h1'] },
    });
    expect(markAsPrinted.mock.calls).toEqual([
      ['default', 'gratitude', ['g1'], 'stamp'],
      ['default', 'hopes', ['h1'], 'stamp'],
    ]);
  });
});
