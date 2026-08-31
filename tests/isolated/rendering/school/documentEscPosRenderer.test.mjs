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
    const label = items.findIndex((i) => i.type === 'text' && i.content === 'Equivalent Fractions');
    const barcode = items.findIndex((i) => i.type === 'barcode');
    expect(label).toBeGreaterThan(-1);
    expect(barcode).toBeGreaterThan(label);
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
    const label = items.findIndex((i) => i.type === 'text' && i.content === 'Equivalent Fractions');
    const qrIndex = items.findIndex((i) => i.type === 'qrcode');
    expect(label).toBeGreaterThan(-1);
    expect(qrIndex).toBeGreaterThan(label);
    expect(items.filter((i) => i.type === 'text' && i.content === 'Equivalent Fractions')).toHaveLength(1);
  });
});

describe('what a child is told', () => {
  it('carries the headline and every line of the agenda as text', () => {
    const text = textOf(renderer.render(agenda()));
    expect(text).toContain('TEST LEARNER');
    // 041155a656 dropped the "Printed " prefix from agendaDocument's
    // timestamp line (receipts.test.mjs's "prints the time a person can
    // read" was updated at the same time) — the bare, person-readable time
    // is the current wording.
    expect(text).toContain('Mon 27 Jul, 9:00 am');
    expect(text).toContain('Finish “Equivalent Fractions” first');
    expect(text).not.toContain('sch:');
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

/**
 * Regression: Learner-Three's result receipt (2026-08-22) printed the literal
 * `undefined · undefined of undefined` between "Passing is 80%" and "NOTES
 * FOR YOU". `block.progress` is the ARRAY `CloseSessionOutcome#learningProgress`
 * always returns (one row for the course, one for the unit) — the old
 * `if (block.progress)` guard tested array TRUTHINESS (always true) and then
 * read `.label`/`.completed`/`.total` off the ARRAY itself, which has none of
 * those properties.
 */
describe('the progress line on a result summary (regression: Learner-Three, 2026-08-22)', () => {
  const withProgress = (progress) => resultDocument({
    sessionId: 'ses_1', unitTitle: 'Unit Two', result: 'passed', percent: 90, progress,
  });

  it('prints nothing for the real, array-shaped progress a builder actually sends — no "undefined" leaks', () => {
    const text = textOf(renderer.render(withProgress([])));
    expect(text).not.toContain('undefined');
  });

  it('prints each row of a real progress array correctly', () => {
    const text = textOf(renderer.render(withProgress([
      { label: 'Course', completed: 2, total: 5 },
      { label: 'Unit 1', completed: 1, total: 3 },
    ])));
    expect(text).toContain('Course · 2 of 5');
    expect(text).toContain('Unit 1 · 1 of 3');
    expect(text).not.toContain('undefined');
  });

  it('prints the active position while preserving the completed count in the row', () => {
    const row = { label: 'Come Follow Me', completed: 0, total: 17, inProgress: 1 };
    const text = textOf(renderer.render(withProgress([row])));
    expect(text).toContain('Come Follow Me · 1 of 17');
    expect(row.completed).toBe(0);
  });

  it('prints NOTHING for a row missing its fields, rather than "undefined · undefined of undefined"', () => {
    const text = textOf(renderer.render(withProgress([{}])));
    expect(text).not.toContain('undefined');
    expect(text).not.toMatch(/·.*of/);
  });

  it('prints nothing for a partially-filled row (label present, counts missing)', () => {
    const text = textOf(renderer.render(withProgress([{ label: 'Course' }])));
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('Course ·');
  });

  it('still accepts a single-object shape defensively, matching the canvas renderer\'s normalisation', () => {
    const text = textOf(renderer.render(withProgress({ label: 'Course', completed: 2, total: 5 })));
    expect(text).toContain('Course · 2 of 5');
  });

  it('prints nothing at all when progress is absent, exactly as before', () => {
    const text = textOf(renderer.render(withProgress(null)));
    expect(text).not.toContain('undefined');
    expect(text).not.toMatch(/·.*of/);
  });
});

describe('which questions were missed, on the text receipt', () => {
  const scored = (extra) => resultDocument({
    sessionId: 'ses_1', unitTitle: 'Unit Two', result: 'failed',
    correctCount: 5, totalCount: 6, questionStart: 7, ...extra,
  });

  it('names the ACTUAL missed question, not the last box', () => {
    // The old row drew boxes left-to-right from correctCount alone, which
    // says "7-11 right, 12 wrong". Here question 7 is the miss.
    const text = textOf(renderer.render(scored({ marks: [false, true, true, true, true, true] })));
    expect(text).toContain('Check again: 7');
    expect(text).not.toContain('Check again: 12');
  });

  it('names every miss, in the sheet\'s own numbering', () => {
    const text = textOf(renderer.render(scored({
      correctCount: 4, marks: [false, true, false, true, true, true],
    })));
    expect(text).toContain('Check again: 7, 9');
  });

  it('includes the same locator-only review lines carried by the raster receipt', () => {
    const text = textOf(renderer.render(scored({
      correctCount: 4, marks: [false, true, false, true, true, true],
      hints: [
        '7: review Beast Academy 2A Guide, pages 24–29 · Ones, Tens, Hundreds.',
        '9: review Beast Academy 2A Guide, pages 24–29 · Ones, Tens, Hundreds.',
      ],
    })));
    expect(text).toContain('REVIEW BEFORE YOU RETRY');
    expect(text).toContain('7: review Beast Academy 2A Guide, pages 24–29 · Ones, Tens, Hundreds.');
    expect(text).toContain('9: review Beast Academy 2A Guide, pages 24–29 · Ones, Tens, Hundreds.');
    expect(text).not.toMatch(/correct answer/i);
  });

  it('says nothing when every question is right', () => {
    const text = textOf(renderer.render(scored({
      correctCount: 6, result: 'passed', marks: [true, true, true, true, true, true],
    })));
    expect(text).toContain('6 of 6 correct');
    expect(text).not.toContain('Check again');
  });

  it('stays silent rather than guessing when no marks were threaded', () => {
    const text = textOf(renderer.render(scored({})));
    expect(text).toContain('5 of 6 correct');
    expect(text).not.toContain('Check again');
  });

  it('stays silent when marks do not cover every question', () => {
    const text = textOf(renderer.render(scored({ marks: [false, true] })));
    expect(text).not.toContain('Check again');
  });

  it('numbers from 1 when the caller threaded no questionStart', () => {
    const text = textOf(renderer.render(resultDocument({
      sessionId: 'ses_1', unitTitle: 'Unit Two', result: 'failed',
      correctCount: 2, totalCount: 3, marks: [true, false, true],
    })));
    expect(text).toContain('Check again: 2');
  });

  it('prints no ✓/× — a codepage-dependent glyph is what put tofu on the canvas receipt', () => {
    const text = textOf(renderer.render(scored({ marks: [false, true, true, true, true, true] })));
    expect(text).not.toContain('✓');
    expect(text).not.toContain('×');
  });
});

describe('bulk_print presentation', () => {
  const bulkDoc = {
    id: 'bulk-sheet', seed: 0, variant: 0, target: ['receipt'],
    blocks: [{
      type: 'scan_action',
      presentation: 'bulk_print',
      action: 'bulk:all-sheets',
      label: 'Print everything',
      subjects: ['Math', 'Reading', 'Science'],
    }],
  };

  it('emits the heading, a bullet per subject, and a barcode carrying the bulk token', () => {
    const job = renderer.render(bulkDoc, { tokens: { 'bulk:all-sheets': TOKEN } });
    const text = textOf(job);
    expect(text).toContain('PRINT ALL SHEETS');
    expect(text).toContain('• Math');
    expect(text).toContain('• Reading');
    expect(text).toContain('• Science');
    const barcodes = barcodesOf(job);
    expect(barcodes).toHaveLength(1);
    expect(barcodes[0].content).toBe(TOKEN);
  });

  it('prints the heading BOLD', () => {
    const job = renderer.render(bulkDoc, { tokens: { 'bulk:all-sheets': TOKEN } });
    const heading = job.items.find((i) => i.type === 'text' && i.content === 'PRINT ALL SHEETS');
    expect(heading).toMatchObject({ style: { bold: true } });
  });

  it("with symbology:'QR' emits a qrcode item instead of a barcode", () => {
    const qrRenderer = createDocumentEscPosRenderer({ symbology: 'QR' });
    const job = qrRenderer.render(bulkDoc, { tokens: { 'bulk:all-sheets': TOKEN } });
    const qrcodes = qrcodesOf(job);
    expect(qrcodes).toHaveLength(1);
    expect(qrcodes[0].content).toBe(TOKEN);
    expect(barcodesOf(job)).toHaveLength(0);
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
      expect(transcript).toContain('Equivalent Fractions');
      // The token itself lands on its own line, which is what a test asserting
      // "the receipt carried token sch:…" reads.
      expect(transcript).toContain(TOKEN);
      expect(transcript.trim().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(captureDir, { recursive: true, force: true });
    }
  });
});
