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
import { readPrintOutcome } from '#domains/core/utils/printOutcome.mjs';
import { PrinterControlService } from '#apps/printer/PrinterControlService.mjs';

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
  const printerService = new PrinterControlService({ fleet: printerRegistry, readPrintOutcome });
  app.use('/api/v1/printer', createPrinterRouter({
    printerService,
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
    expect(res.body).toEqual({
      success: true,
      dispatched: true,
      verified: true,
      verification: 'verified',
      faults: null,
      printerState: null,
      message: 'Text printed successfully',
      printJob: { items: [{ type: 'text', text: 'hello' }], options: {} },
    });
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

  it('keeps location lookup ahead of body validation', async () => {
    const fleet = {
      list: vi.fn(() => []),
      resolve: vi.fn(() => { throw new Error('Unknown printer location: "missing"'); }),
    };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/printer', createPrinterRouter({
      printerService: new PrinterControlService({ fleet, readPrintOutcome }),
    }));
    const res = await request(app).post('/api/v1/printer/text/missing').send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Unknown printer location: "missing"' });
  });

  it('preserves the remaining route surfaces and printer job options', async () => {
    const adapter = {
      getHost: vi.fn(() => 'printer.local'),
      getPort: vi.fn(() => 9100),
      ping: vi.fn(async () => ({ success: false, configured: true, host: 'printer.local' })),
      getStatus: vi.fn(async () => ({ success: true, feedButtonEnabled: false })),
      createImagePrint: vi.fn((path, options) => ({ kind: 'image', path, options })),
      createReceiptPrint: vi.fn(data => ({ kind: 'receipt', data })),
      createTablePrint: vi.fn(data => ({ kind: 'table', data })),
      setFeedButton: vi.fn(enabled => ({ kind: 'feed', enabled })),
      print: vi.fn(async () => true),
    };
    const fleet = { list: vi.fn(() => [{ name: 'upstairs', host: 'printer.local', port: 9100, isDefault: true }]), resolve: vi.fn(() => adapter) };
    const app = express();
    app.use(express.json());
    app.use('/api/v1/printer', createPrinterRouter({
      printerService: new PrinterControlService({ fleet, readPrintOutcome }),
    }));

    const root = await request(app).get('/api/v1/printer');
    expect(root.body.printers).toEqual([{ name: 'upstairs', host: 'printer.local', port: 9100, isDefault: true }]);
    expect((await request(app).get('/api/v1/printer/ping')).status).toBe(503);
    expect((await request(app).get('/api/v1/printer/status')).body)
      .toEqual({ success: true, feedButtonEnabled: false });

    const image = await request(app).post('/api/v1/printer/image/upstairs')
      .send({ path: '/tmp/picture.png', options: { align: 'center' } });
    expect(image.body.printJob).toEqual({ kind: 'image', path: '/tmp/picture.png', options: { align: 'center' } });
    expect((await request(app).post('/api/v1/printer/receipt').send({ total: 12 })).body.printJob)
      .toEqual({ kind: 'receipt', data: { total: 12 } });
    expect((await request(app).post('/api/v1/printer/table').send({ headers: ['A'] })).body.printJob)
      .toEqual({ kind: 'table', data: { headers: ['A'] } });
    expect((await request(app).post('/api/v1/printer/print').send({ items: [] })).body.message)
      .toBe('Print job completed successfully');
    expect((await request(app).get('/api/v1/printer/feed-button')).body)
      .toEqual({
        success: true,
        feedButtonEnabled: false,
        note: 'Feed button status cannot be queried directly from most ESC/POS printers',
      });
    // The general optional-location route precedes /on and /off in HEAD, so
    // those URLs continue to be interpreted as location names. Pin that route
    // ordering here rather than silently "fixing" it during the layer move.
    expect((await request(app).get('/api/v1/printer/feed-button/on')).body)
      .toEqual({
        success: true,
        feedButtonEnabled: false,
        note: 'Feed button status cannot be queried directly from most ESC/POS printers',
      });
    expect((await request(app).get('/api/v1/printer/feed-button/off')).body)
      .toEqual({
        success: true,
        feedButtonEnabled: false,
        note: 'Feed button status cannot be queried directly from most ESC/POS printers',
      });
  });
});
