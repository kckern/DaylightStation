import { describe, expect, it, vi } from 'vitest';
import { GratitudeCardPrintService } from './GratitudeCardPrintService.mjs';

describe('GratitudeCardPrintService', () => {
  it('returns semantic printer resolution and verified print outcomes', async () => {
    const printer = {};
    const print = vi.fn(async () => ({ verified: true }));
    const service = new GratitudeCardPrintService({
      printerRegistry: { resolve: () => printer }, imagePrintGateway: { print },
    });
    const operation = service.prepare('kitchen');
    expect(operation.kind).toBe('ready');
    await expect(operation.print({ buffer: Buffer.from('png'), width: 1, height: 2 }))
      .resolves.toEqual({ kind: 'completed', success: true });
    expect(print).toHaveBeenCalledWith(printer, expect.objectContaining({ align: 'left', threshold: 128 }));
  });

  it('keeps printer lookup failures semantic', async () => {
    const service = new GratitudeCardPrintService({
      printerRegistry: { resolve() { throw new Error('Unknown printer: attic'); } },
      imagePrintGateway: { print: vi.fn() },
    });
    expect(service.prepare('attic'))
      .toEqual({ kind: 'printer_not_found', message: 'Unknown printer: attic' });
  });
});
