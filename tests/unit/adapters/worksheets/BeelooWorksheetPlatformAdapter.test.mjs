import { describe, expect, it, vi } from 'vitest';
import { BeelooWorksheetPlatformAdapter } from '#adapters/worksheets/BeelooWorksheetPlatformAdapter.mjs';
import { IWorksheetPlatform } from '#apps/common/ports/IWorksheetPlatform.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const json = (body) => ({ ok: true, status: 200, json: async () => body });
const pdf = () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4').buffer });
const make = (fetchImpl, logger = silent) => new BeelooWorksheetPlatformAdapter({ baseUrl: 'http://beeloo-app:8111', fetchImpl, logger });

describe('BeelooWorksheetPlatformAdapter', () => {
  it('is an IWorksheetPlatform with id beeloo', () => {
    const a = make(vi.fn());
    expect(a).toBeInstanceOf(IWorksheetPlatform);
    expect(a.id).toBe('beeloo');
  });

  it('lists activities in the neutral vocabulary', async () => {
    const fetchImpl = vi.fn(async () => json({ valid: true, items: [
      { beeloo_id: 'glD5B71Bj', theme: 'boston', title: 'North End Labyrinth', contentType: 'maze', skillLevel: 3 },
    ] }));
    const rows = await make(fetchImpl).listActivities({ kind: 'maze', level: 3 });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://beeloo-app:8111/api/pages?contentType=maze&skillLevel=3&pageMax=250');
    expect(rows).toEqual([{ externalId: 'glD5B71Bj', title: 'North End Labyrinth', kind: 'maze', level: 3, theme: 'boston' }]);
  });

  it('passes an AbortSignal so a hung Beeloo times out', async () => {
    const fetchImpl = vi.fn(async () => json({ valid: true, items: [] }));
    await make(fetchImpl).listActivities({ kind: 'maze', level: 3 });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('drops items with a malformed id', async () => {
    const fetchImpl = async () => json({ valid: true, items: [
      { beeloo_id: '../x', title: 'bad', contentType: 'maze', skillLevel: 3 },
      { title: 'no id', contentType: 'maze', skillLevel: 3 },
      { beeloo_id: 'vz9E9A4N5', title: 'Good', contentType: 'maze', skillLevel: 3 },
    ] });
    const rows = await make(fetchImpl).listActivities({ kind: 'maze', level: 3 });
    expect(rows.map((r) => r.externalId)).toEqual(['vz9E9A4N5']);
    expect(rows[0].theme).toBeNull();
  });

  it('throws when Beeloo answers valid:false', async () => {
    await expect(make(async () => json({ valid: false })).listActivities({ kind: 'maze', level: 3 })).rejects.toThrow(/beeloo/i);
  });

  it('throws on an HTTP 500 from pages', async () => {
    await expect(make(async () => ({ ok: false, status: 500 })).listActivities({ kind: 'maze', level: 3 }))
      .rejects.toThrow(/HTTP 500/);
  });

  it('fetches the printable PDF for the paper size', async () => {
    const fetchImpl = vi.fn(async () => pdf());
    const bytes = await make(fetchImpl).getPrintable('glD5B71Bj', { paper: 'letter' });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://beeloo-app:8111/media/letter/printable/glD5B71Bj.pdf');
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('fetches the solution from the solution folder', async () => {
    const fetchImpl = vi.fn(async () => pdf());
    await make(fetchImpl).getSolution('glD5B71Bj', { paper: 'a4' });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://beeloo-app:8111/media/a4/solution/glD5B71Bj.pdf');
  });

  it('refuses an id that is not a Beeloo id (path safety)', async () => {
    const fetchImpl = vi.fn();
    await expect(make(fetchImpl).getPrintable('../etc/passwd')).rejects.toThrow(/id/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an unsupported paper size', async () => {
    const fetchImpl = vi.fn();
    await expect(make(fetchImpl).getPrintable('glD5B71Bj', { paper: 'legal' })).rejects.toThrow(/paper/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers null for a missing solution', async () => {
    expect(await make(async () => ({ ok: false, status: 404 })).getSolution('glD5B71Bj')).toBeNull();
  });

  it('throws for a missing printable', async () => {
    await expect(make(async () => ({ ok: false, status: 404 })).getPrintable('glD5B71Bj')).rejects.toThrow(/no printable/);
  });

  it('throws on a non-PDF printable', async () => {
    const notPdf = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('<html>').buffer });
    await expect(make(notPdf).getPrintable('glD5B71Bj')).rejects.toThrow(/pdf/i);
  });

  it('logs a fetch rejection at warn and rethrows', async () => {
    const logger = { ...silent, warn: vi.fn() };
    const boom = async () => { throw new Error('ECONNREFUSED'); };
    await expect(make(boom, logger).getPrintable('glD5B71Bj')).rejects.toThrow(/ECONNREFUSED/);
    expect(logger.warn).toHaveBeenCalledWith('worksheets.beeloo.request-failed', expect.objectContaining({
      url: 'http://beeloo-app:8111/media/letter/printable/glD5B71Bj.pdf', error: 'ECONNREFUSED',
    }));
  });
});
