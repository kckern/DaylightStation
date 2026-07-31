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
  learnerName: 'Test Learner',
  generatedAt: '2026-07-27T09:00:00.000Z',
  timeZone: 'UTC',
  sections: [
    {
      subject: 'math',
      next: { title: 'Equivalent Fractions', unitId: 'u1', actionLabel: 'watch or listen' },
    },
    {
      subject: 'reading',
      lockedRemedy: 'Finish “Equivalent Fractions” first',
    },
  ],
  tokensBySubject: { math: TOKEN },
});

const textOf = (job) => job.items.filter((i) => i.type === 'text').map((i) => i.content).join('\n');
const barcodesOf = (job) => job.items.filter((i) => i.type === 'barcode');
const qrcodesOf = (job) => job.items.filter((i) => i.type === 'qrcode');

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

  it('DEFAULT symbology still emits a barcode item — the QR renderer is opt-in', () => {
    // Regression: constructing with no `symbology` at all (the school console's
    // pre-Task-12 shape) must keep printing a real Code128, never silently
    // switch to QR.
    const defaultRenderer = createDocumentEscPosRenderer();
    const items = defaultRenderer.render(agenda()).items;
    expect(barcodesOf({ items })).toHaveLength(1);
    expect(barcodesOf({ items })[0].format).toBe('CODE128');
    expect(qrcodesOf({ items })).toHaveLength(0);
  });

  it("symbology:'QR' emits a qrcode item carrying the token, with NO barcode item and NO duplicate label", () => {
    const qrRenderer = createDocumentEscPosRenderer({ symbology: 'QR' });
    const items = qrRenderer.render(agenda()).items;
    const qrcodes = qrcodesOf({ items });
    expect(qrcodes).toHaveLength(1);
    expect(qrcodes[0].content).toBe(TOKEN);
    expect(barcodesOf({ items })).toHaveLength(0);

    // The label text item immediately precedes the code — same convention as
    // a barcode — and appears exactly once (the adapter must not double it).
    const label = items.findIndex((i) => i.type === 'text' && i.content === 'Equivalent Fractions — watch or listen');
    const qrIndex = items.findIndex((i) => i.type === 'qrcode');
    expect(label).toBeGreaterThan(-1);
    expect(qrIndex).toBe(label + 1);
    expect(items.filter((i) => i.type === 'text' && i.content === 'Equivalent Fractions — watch or listen')).toHaveLength(1);
  });
});

describe('what a child is told', () => {
  it('carries the headline and every line of the agenda as text', () => {
    const text = textOf(renderer.render(agenda()));
    expect(text).toContain('TEST LEARNER');
    expect(text).toContain('Printed Mon 27 Jul, 9:00 am');
    expect(text).toContain('Finish “Equivalent Fractions” first');
    expect(text).toContain('Scan a line above to start.');
  });

  it('prints the standard header INVERTED — the black band the canvas renderer draws', () => {
    const header = renderer.render(agenda()).items[0];
    expect(header).toMatchObject({
      type: 'text',
      content: ' TEST LEARNER ',
      align: 'center',
      style: { bold: true, invert: true },
      size: { width: 2, height: 2 },
    });
  });

  it('an untitled document gets no header item', () => {
    const document = {
      id: 'sheet', seed: 0, variant: 0, target: ['receipt'],
      blocks: [{ type: 'rich_text', md: 'Just a line.' }],
    };
    const job = renderer.render(document);
    expect(job.items[0]).toMatchObject({ type: 'text', content: 'Just a line.' });
  });

  it('renders a `## ` subject header bold, left-aligned and NORMAL size — unlike a bare `#`', () => {
    const document = {
      id: 'sheet', seed: 0, variant: 0, target: ['receipt'],
      blocks: [{ type: 'rich_text', md: '## MATH — Unit 2 of 4' }],
    };
    const heading = renderer.render(document).items.find((i) => i.type === 'text');
    expect(heading).toMatchObject({ content: 'MATH — Unit 2 of 4', align: 'left', style: { bold: true } });
    // NOT double-size like a bare `#` — a `## ` header is a subject line among
    // several on one receipt, not the one banner at the top.
    expect(heading.size).toBeUndefined();
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
      expect(transcript).toContain('TEST LEARNER');
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
