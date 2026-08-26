/**
 * Sibling of the ReceiptPrinting claim-tier fix (2026-08-25): the printer
 * router's `printConfirmed` read `verified` as the only success tier, so an
 * operator hitting `/print` over a dispatched-but-`unreadable` job was told
 * "Print failed" even though paper came out. Pinned here with a plain
 * adapter double, via the real routes (the mapping functions aren't
 * exported).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPrinterRouter } from './printer.mjs';

function appWith(outcome) {
  const adapter = {
    print: vi.fn(async () => outcome),
    createTextPrint: vi.fn((text, options) => ({ items: [{ type: 'text', text }], options })),
  };
  const printerRegistry = {
    resolve: vi.fn(() => adapter),
    list: vi.fn(() => []),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/printer', createPrinterRouter({
    printerRegistry,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
  return { app, adapter };
}

const post = (app) => request(app).post('/api/v1/printer/text').send({ text: 'hello' });

describe('printer router claim-tier mapping', () => {
  it('verified outcome reports success', async () => {
    const { app } = appWith({ dispatched: true, verified: true, verification: 'verified' });
    const res = await post(app);
    expect(res.body.success).toBe(true);
  });

  it('dispatched with an UNREADABLE status reports success — silence is not failure', async () => {
    const { app } = appWith({ dispatched: true, verified: false, verification: 'unreadable' });
    const res = await post(app);
    expect(res.body.success).toBe(true);
    // Tier detail still distinguishes it from a confirmed print for debugging.
    expect(res.body.verified).toBe(false);
    expect(res.body.verification).toBe('unreadable');
  });

  it('dispatched with a DETECTED FAULT reports failure', async () => {
    const { app } = appWith({ dispatched: true, verified: false, verification: 'faulted', faults: ['cover_open'] });
    const res = await post(app);
    expect(res.body.success).toBe(false);
    expect(res.body.verification).toBe('faulted');
    expect(res.body.faults).toEqual(['cover_open']);
  });

  it('never dispatched reports failure', async () => {
    const { app } = appWith({ dispatched: false, verified: false, verification: 'unreadable' });
    const res = await post(app);
    expect(res.body.success).toBe(false);
  });

  it('a bare true is back-compat success', async () => {
    const { app } = appWith(true);
    const res = await post(app);
    expect(res.body.success).toBe(true);
  });

  it('a bare false is failure', async () => {
    const { app } = appWith(false);
    const res = await post(app);
    expect(res.body.success).toBe(false);
  });
});
