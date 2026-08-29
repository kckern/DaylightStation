/**
 * `DocumentReceiptRasterRenderer` — the bridge from `DocumentReceiptRenderer`'s
 * canvas to the ESC/POS image job `ThermalPrinterAdapter.print()` accepts.
 *
 * What matters here is the composition, not the pixels: a raster job carries
 * the transcript/codes a bare `{type:'image'}` item cannot, a raster failure
 * falls back to the ESC/POS renderer rather than leaving a child with
 * nothing, and the scratch PNG it writes is both real (the printer needs a
 * filesystem path) and cleaned up.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { createDocumentReceiptRasterRenderer } from '#adapters/school/documents/DocumentReceiptRasterAdapter.mjs';
import { createDocumentEscPosRenderer } from '#rendering/school/documents/DocumentEscPosRenderer.mjs';
import { agendaDocument } from '#domains/school/documents/receipts.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TOKEN = 'sch:2K7QVM4X9HRJTBNP';

const doc = () => agendaDocument({
  learnerId: 'kid1',
  learnerName: 'Test Learner',
  generatedAt: '2026-07-27T09:00:00.000Z',
  timeZone: 'UTC',
  sections: [
    { subject: 'math', next: { title: 'Equivalent Fractions', unitId: 'u1', actionLabel: 'watch or listen' } },
  ],
  tokensBySubject: { math: TOKEN },
});

/** A fake canvas renderer, so this suite tests the bridge, not resvg/canvas. */
function fakeCanvasRenderer({ fail = false } = {}) {
  return {
    async createCanvas() {
      if (fail) throw new Error('canvas allocation failed');
      return {
        canvas: { toBuffer: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
        width: 580,
        height: 900,
      };
    },
  };
}

const escPosRenderer = createDocumentEscPosRenderer({ symbology: 'QR' });

const writtenPaths = [];

describe('createDocumentReceiptRasterRenderer', () => {
  afterEach(() => {
    for (const p of writtenPaths.splice(0)) {
      try { fs.rmSync(p, { force: true }); } catch { /* already gone */ }
    }
  });

  it('renders a raster job: one image item, a populated transcript, and the scannable codes', async () => {
    const renderer = createDocumentReceiptRasterRenderer({
      canvasRenderer: fakeCanvasRenderer(), escPosRenderer, logger: silent,
    });
    const job = await renderer.render(doc());
    writtenPaths.push(job.items[0].path);

    expect(job.items).toHaveLength(1);
    expect(job.items[0]).toMatchObject({ type: 'image', width: 580, height: 900, align: 'left' });
    expect(fs.existsSync(job.items[0].path)).toBe(true);
    expect(job.footer).toMatchObject({ autoCut: true });

    // Same words the ESC/POS renderer would have printed — the operator
    // transcript survives even though nothing text-shaped reached the wire.
    expect(job.transcript).toContain('TEST LEARNER');
    expect(job.transcript).toContain('Equivalent Fractions');
    expect(job.transcript).toContain(TOKEN);

    // The same code a text job would have offered as a `qrcode` item, handed
    // over as data instead of an item a raster job cannot carry — WITH the
    // lesson-card lines that preceded it on the tape. Those lines are the
    // only surviving text once the receipt is pixels, and they are what tells
    // a reader (and the school e2e suites) what the scan actually DOES, not
    // merely which lesson it belongs to.
    expect(job.codes).toHaveLength(1);
    expect(job.codes[0]).toMatchObject({ token: TOKEN, label: 'Equivalent Fractions' });
    expect(job.codes[0].printed).toContain('Equivalent Fractions');
    expect(job.codes[0].printed).toContain('WATCH OR LISTEN');
  });

  it('cleans up its scratch PNG when cleanup() is called, and not before', async () => {
    const renderer = createDocumentReceiptRasterRenderer({
      canvasRenderer: fakeCanvasRenderer(), escPosRenderer, logger: silent,
    });
    const job = await renderer.render(doc());
    const tempPath = job.items[0].path;
    expect(fs.existsSync(tempPath)).toBe(true);
    await job.cleanup();
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('falls back to the ESC/POS renderer when the raster path throws', async () => {
    const renderer = createDocumentReceiptRasterRenderer({
      canvasRenderer: fakeCanvasRenderer({ fail: true }), escPosRenderer, logger: silent,
    });
    const job = await renderer.render(doc());
    // The plain ESC/POS job: text + a real qrcode item, no image, no cleanup.
    expect(job.items.some((i) => i.type === 'image')).toBe(false);
    expect(job.items.some((i) => i.type === 'qrcode')).toBe(true);
    expect(job.cleanup).toBeUndefined();
  });

  it('propagates the raster failure when there is no ESC/POS renderer to fall back to', async () => {
    const renderer = createDocumentReceiptRasterRenderer({
      canvasRenderer: fakeCanvasRenderer({ fail: true }), logger: silent,
    });
    await expect(renderer.render(doc())).rejects.toThrow(/canvas allocation failed/);
  });

  it('degrades to an empty transcript rather than failing the raster when transcript generation throws', async () => {
    const throwingEscPos = { render: () => { throw new Error('unsupported block'); } };
    const renderer = createDocumentReceiptRasterRenderer({
      canvasRenderer: fakeCanvasRenderer(), escPosRenderer: throwingEscPos, logger: silent,
    });
    const job = await renderer.render(doc());
    writtenPaths.push(job.items[0].path);
    expect(job.items[0].type).toBe('image');
    expect(job.transcript).toBe('');
    expect(job.codes).toEqual([]);
  });

  it('renders with no ESC/POS renderer at all: raster succeeds, transcript/codes are empty', async () => {
    const renderer = createDocumentReceiptRasterRenderer({ canvasRenderer: fakeCanvasRenderer(), logger: silent });
    const job = await renderer.render(doc());
    writtenPaths.push(job.items[0].path);
    expect(job.items[0].type).toBe('image');
    expect(job.transcript).toBe('');
    expect(job.codes).toEqual([]);
  });

  it('requires a canvasRenderer to construct at all', () => {
    expect(() => createDocumentReceiptRasterRenderer({})).toThrow(/canvasRenderer/);
  });
});
