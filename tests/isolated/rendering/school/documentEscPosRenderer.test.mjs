/**
 * The receipt renderer that actually reaches paper.
 *
 * Production rendered receipts to a PNG and sent one `{type:'image'}` item. The
 * PNG contains no barcode at all — the canvas draws an empty square where the
 * code belongs — so the child had nothing to scan, and the printer's text
 * transcript (what the e2e suite and the operator log read) was empty.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentEscPosRenderer, ReceiptBlockError } from '#rendering/school/documents/DocumentEscPosRenderer.mjs';
import { agendaDocument, resultDocument, noticeDocument } from '#domains/school/documents/receipts.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { VirtualThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const renderer = createDocumentEscPosRenderer();
const silent = { info() {}, warn() {}, error() {}, debug() {} };

const TOKEN = 'sch:2K7QVM4X9HRJTBNP';

const agenda = () => agendaDocument({
  learnerId: 'kid1',
  learnerName: 'learner-two',
  generatedAt: '2026-07-27T09:00:00.000Z',
  entries: [
    { unitId: 'u1', title: 'Equivalent Fractions', status: 'available', token: TOKEN, actionLabel: 'Equivalent Fractions — watch or listen' },
    { unitId: 'u2', title: 'Unlike Denominators', status: 'locked', lockReason: 'Finish “Equivalent Fractions” first' },
  ],
});

const textOf = (job) => job.items.filter((i) => i.type === 'text').map((i) => i.content).join('\n');
const barcodesOf = (job) => job.items.filter((i) => i.type === 'barcode');

describe('the three receipts this console prints', () => {
  it.each([
    ['agenda', agenda],
    ['result', () => resultDocument({
      sessionId: 'ses_1', unitTitle: 'Unlike Denominators', result: 'needs_remediation',
      percent: 50, objectives: ['Add unlike denominators'],
      actions: [{ token: TOKEN, label: 'Try again with a fresh sheet' }],
    })],
    ['notice', () => noticeDocument({
      id: 'print-failed', headline: 'The printer is not answering',
      lines: ['Your work is safe.'], actions: [{ token: TOKEN, label: 'Try printing again' }],
    })],
  ])('renders the %s document to an ESC/POS job', (_label, build) => {
    const document = build();
    expect(validateDocument(document).errors).toEqual([]);
    const job = renderer.render(document);
    expect(job.items.length).toBeGreaterThan(0);
    expect(job.footer).toMatchObject({ autoCut: true });
  });
});

describe('the code a child scans', () => {
  it('EMITS A REAL BARCODE ITEM, not a picture of an empty box', () => {
    const barcodes = barcodesOf(renderer.render(agenda()));
    expect(barcodes).toHaveLength(1);
    expect(barcodes[0].content).toBe(TOKEN);
    expect(barcodes[0].format).toBe('CODE128');
  });

  it('prints the label BEFORE the code, so the stripes mean something', () => {
    const items = renderer.render(agenda()).items;
    const label = items.findIndex((i) => i.type === 'text' && i.content === 'Equivalent Fractions — watch or listen');
    const barcode = items.findIndex((i) => i.type === 'barcode');
    expect(label).toBeGreaterThan(-1);
    expect(barcode).toBe(label + 1);
  });

  it('resolves an action naming a token class through the minted map', () => {
    const document = {
      id: 'sheet', seed: 0, variant: 0, target: ['receipt'],
      blocks: [{ type: 'scan_action', action: 'recovery', label: 'Another copy' }],
    };
    const barcodes = barcodesOf(renderer.render(document, { tokens: { recovery: TOKEN } }));
    expect(barcodes[0].content).toBe(TOKEN);
  });
});

describe('what a child is told', () => {
  it('carries the headline and every line of the agenda as text', () => {
    const text = textOf(renderer.render(agenda()));
    expect(text).toContain('learner-two');
    expect(text).toContain('Printed Mon 27 Jul, 9:00 am');
    expect(text).toContain('Finish “Equivalent Fractions” first');
    expect(text).toContain('Scan a line above to start.');
  });

  it('sets a markdown heading in double size and centred', () => {
    const heading = renderer.render(agenda()).items.find((i) => i.type === 'text' && i.content === 'learner-two');
    expect(heading).toMatchObject({ align: 'center', size: { width: 2, height: 2 } });
    expect(heading.content).not.toContain('#');
  });

  it('refuses a block it cannot print rather than dropping it', () => {
    const document = {
      id: 'bad', seed: 0, variant: 0, target: ['receipt'],
      blocks: [{ type: 'omr_response', itemId: 'q1', choices: 4 }],
    };
    expect(() => renderer.render(document)).toThrow(ReceiptBlockError);
  });
});

describe('through the real thermal adapter', () => {
  it('LEAVES A READABLE TRANSCRIPT — an image job left it empty', async () => {
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escpos-'));
    try {
      const printer = new VirtualThermalPrinterAdapter({ captureDir }, { logger: silent });
      expect(await printer.print(renderer.render(agenda()))).toBe(true);

      const transcript = printer.lastTranscript();
      expect(transcript).toContain('learner-two');
      expect(transcript).toContain('Equivalent Fractions — watch or listen');
      // The token itself lands on its own line, which is what a test asserting
      // "the receipt carried token sch:…" reads.
      expect(transcript).toContain(TOKEN);
      expect(transcript.trim().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(captureDir, { recursive: true, force: true });
    }
  });
});
