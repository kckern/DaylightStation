// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ReadPrinterHealth } from './ReadPrinterHealth.mjs';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

const withStatus = (status) => new ReadPrinterHealth({
  printer: { getStatus: async () => status },
  logger: silentLogger(),
});

describe('ReadPrinterHealth', () => {
  it('an idle printer with nothing to report is healthy', async () => {
    const out = await withStatus({ state: 'idle', stateReasons: [] }).execute();
    expect(out).toMatchObject({ healthy: true, state: 'idle', sentence: null });
  });

  it('a printer mid-job is healthy', async () => {
    const out = await withStatus({ state: 'processing', stateReasons: [] }).execute();
    expect(out.healthy).toBe(true);
  });

  it.each([
    ['media-empty', 'The printer is out of paper — tell a grown-up.'],
    ['media-jam', 'The printer is jammed — tell a grown-up.'],
    ['cover-open', 'The printer is open — tell a grown-up.'],
    ['toner-empty', 'The printer is out of ink — tell a grown-up.'],
    ['offline', "The printer isn't answering — tell a grown-up."],
  ])('names the fault for %s in words a child can act on', async (reason, sentence) => {
    const out = await withStatus({ state: 'stopped', stateReasons: [reason] }).execute();
    expect(out).toMatchObject({ healthy: false, sentence, reason });
  });

  it('reads through the IPP -error severity suffix', async () => {
    const out = await withStatus({ state: 'stopped', stateReasons: ['media-empty-error'] }).execute();
    expect(out.reason).toBe('media-empty');
  });

  // A false fault is worse than no fault: it turns a question the child could
  // have answered into a dead end.
  it('a -warning severity is NOT a fault', async () => {
    const out = await withStatus({ state: 'idle', stateReasons: ['toner-low-warning'] }).execute();
    expect(out.healthy).toBe(true);
  });

  it('a -report severity is NOT a fault', async () => {
    const out = await withStatus({ state: 'idle', stateReasons: ['media-low-report'] }).execute();
    expect(out.healthy).toBe(true);
  });

  it('an unrecognised reason on an idle printer is NOT a fault', async () => {
    const out = await withStatus({ state: 'idle', stateReasons: ['some-vendor-thing'] }).execute();
    expect(out.healthy).toBe(true);
  });

  it('a stopped printer with nothing recognisable to say is still a fault', async () => {
    const out = await withStatus({ state: 'stopped', stateReasons: ['some-vendor-thing'] }).execute();
    expect(out).toMatchObject({ healthy: false, reason: 'stopped' });
    expect(out.sentence).toMatch(/tell a grown-up/);
  });

  it('names the jam when a printer reports several blocking things at once', async () => {
    const out = await withStatus({ state: 'stopped', stateReasons: ['cover-open', 'media-jam'] }).execute();
    expect(out.reason).toBe('media-jam');
  });

  // UNKNOWN IS NOT A FAULT. Both of these leave the caller's own fallback in
  // charge rather than stranding a child on a message we cannot justify.
  it('reports unknown, never a fault, when no printer is wired', async () => {
    const out = await new ReadPrinterHealth({ logger: silentLogger() }).execute();
    expect(out).toMatchObject({ ok: true, healthy: null, reason: 'not_wired' });
  });

  it('reports unknown, never a fault, when the status read throws', async () => {
    const logger = silentLogger();
    const out = await new ReadPrinterHealth({
      printer: { getStatus: async () => { throw new Error('ETIMEDOUT'); } },
      logger,
    }).execute();
    expect(out).toMatchObject({ ok: true, healthy: null, reason: 'status_failed' });
    expect(logger.warn).toHaveBeenCalledWith('school.printer.status-failed', { error: 'ETIMEDOUT' });
  });
});
