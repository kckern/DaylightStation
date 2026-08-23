/**
 * WHERE A PANEL CODE MAY APPEAR — under its QR, and NOWHERE ELSE.
 *
 * The six-digit panel code is the typable alias for a scan token. It only
 * means anything as a fallback for the QR it sits beneath: "scan this, or if
 * you cannot, type this."
 *
 * IT USED TO BE TWO LOOSE TEXT BLOCKS pushed after the card — "PANEL CODE
 * 928521" and "Type it on the school screen." — which the canvas renderer drew
 * BELOW the card's border, adrift from the QR. On paper that reads as a stray
 * number with no referent, and on a two-offer agenda a child genuinely cannot
 * tell which offer it belongs to. An earlier version of THIS suite asserted
 * only that such a block was "immediately preceded by a scan_action", which
 * that broken layout satisfied — the test encoded the wrong rule and passed.
 *
 * The rule is now structural rather than positional: a present code is a FIELD
 * on the scan_action block, so there is no loose block that could drift. These
 * specs assert both halves — the field is set, and no code text exists anywhere
 * in the block stream.
 */
import { describe, it, expect } from 'vitest';
import { agendaDocument, resultDocument, noticeDocument } from '#domains/school/documents/receipts.mjs';

const TOKEN_A = 'sch:2K7QVM4X9HRJTBNP';
const TOKEN_B = 'sch:9ZZZVM4X9HRJTBQQ';

/** Any block whose printed words contain a six-digit run — the drift detector. */
const looseCodeText = (document) => (document.blocks ?? [])
  .filter((b) => b.type !== 'scan_action')
  .filter((b) => /\d{6}/.test(String(b.md ?? '')));

const scanActions = (document) => (document.blocks ?? []).filter((b) => b.type === 'scan_action');

describe('agenda receipts', () => {
  const agenda = (over = {}) => agendaDocument({
    learnerId: 'milo',
    learnerName: 'Milo',
    generatedAt: '2026-08-23T16:00:00.000Z',
    timeZone: 'UTC',
    sections: [
      { subject: 'civilization', next: { title: 'Michigan', unitId: 'u1', actionLabel: 'print your sheet' } },
      { subject: 'maths', next: { title: 'Fractions', unitId: 'u2', actionLabel: 'print your sheet' } },
    ],
    tokensBySubject: { civilization: TOKEN_A, maths: TOKEN_B },
    accessCodesByToken: { [TOKEN_A]: '123456', [TOKEN_B]: '654321' },
    ...over,
  });

  it('carries each code ON its own scan_action, so it can only draw under that QR', () => {
    expect(scanActions(agenda()).map((b) => b.panelCode)).toEqual(['123456', '654321']);
  });

  it('emits NO loose code text anywhere — not a PANEL CODE line, not an instruction line', () => {
    const document = agenda();
    expect(looseCodeText(document)).toEqual([]);
    const words = document.blocks.map((b) => String(b.md ?? '')).join('\n');
    expect(words).not.toContain('PANEL CODE');
    expect(words).not.toContain('Type it on the school screen.');
  });

  it('sets no code field at all when none was minted', () => {
    const document = agenda({ accessCodesByToken: {} });
    scanActions(document).forEach((b) => expect(b.panelCode).toBeUndefined());
    expect(looseCodeText(document)).toEqual([]);
  });

  it('does not put a code near a grown-up note, which has no QR to alias', () => {
    const document = agenda({ notes: ['Check question 7 again.'] });
    expect(looseCodeText(document)).toEqual([]);
  });
});

describe('result receipts', () => {
  const result = (over = {}) => resultDocument({
    sessionId: 'ses_1',
    unitTitle: 'The Midwestern States',
    result: 'passed',
    percent: 100,
    correctCount: 6,
    totalCount: 6,
    actions: [{ token: TOKEN_A, label: 'Michigan', accessCode: '312524', presentation: 'lesson' }],
    ...over,
  });

  it('carries the next-up code on the next-up action', () => {
    expect(scanActions(result()).map((b) => b.panelCode)).toEqual(['312524']);
    expect(looseCodeText(result())).toEqual([]);
  });

  it('sets no code when the action never minted one', () => {
    const document = result({ actions: [{ token: TOKEN_A, label: 'Michigan', presentation: 'lesson' }] });
    expect(scanActions(document)[0].panelCode).toBeUndefined();
  });

  it('says scanning is the only way in rather than leaving a silent gap', () => {
    // The tri-state: an explicitly NULL code means "there is no typable
    // alias", which must be said in words — the ONE case that still earns a
    // block, because an absence cannot be drawn under a QR.
    const document = result({
      actions: [{ token: TOKEN_A, label: 'Michigan', accessCode: null, presentation: 'lesson' }],
    });
    expect(scanActions(document)[0].panelCode).toBeUndefined();
    expect(document.blocks.map((b) => String(b.md ?? '')).join('\n')).toContain('Scanning is the only way in.');
  });
});

describe('notice receipts', () => {
  it('carries the code on the action, with no loose text', () => {
    const document = noticeDocument({
      title: 'Nothing to do',
      lines: ['Come back tomorrow.'],
      actions: [{ token: TOKEN_A, label: 'Try again', accessCode: '111111' }],
    });
    expect(scanActions(document)[0].panelCode).toBe('111111');
    expect(looseCodeText(document)).toEqual([]);
  });
});

describe('the renderers put it under the QR and nowhere else', () => {
  const twoOfferAgenda = () => agendaDocument({
    learnerId: 'milo',
    learnerName: 'Milo',
    generatedAt: '2026-08-23T16:00:00.000Z',
    timeZone: 'UTC',
    sections: [
      { subject: 'civilization', next: { title: 'Michigan', unitId: 'u1', actionLabel: 'print your sheet' } },
      { subject: 'maths', next: { title: 'Fractions', unitId: 'u2', actionLabel: 'print your sheet' } },
    ],
    tokensBySubject: { civilization: TOKEN_A, maths: TOKEN_B },
    accessCodesByToken: { [TOKEN_A]: '123456', [TOKEN_B]: '654321' },
    notes: ['Check question 7 again.'],
  });

  it('the canvas renderer draws the code inside its own action, not as a page-level block', async () => {
    const { createDocumentReceiptRenderer } = await import('#rendering/school/documents/DocumentReceiptRenderer.mjs');
    const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
    // `codes` is the renderer's own report of what it drew beneath each code
    // area — one entry per action, carrying that action's own lines.
    const { codes } = await renderer.createCanvas(twoOfferAgenda());
    expect(codes.map((c) => c.lines)).toEqual([['123456'], ['654321']]);
    // Each code is reported against the token it aliases, never pooled.
    expect(codes.map((c) => c.action)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it('the text renderer emits each code immediately after its own qrcode item', async () => {
    const { createDocumentEscPosRenderer } = await import('#rendering/school/documents/DocumentEscPosRenderer.mjs');
    const { items } = createDocumentEscPosRenderer({ symbology: 'QR' }).render(twoOfferAgenda());

    const codeIndexes = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => /^PANEL CODE \d{6}$/.test(String(item.content ?? '').trim()))
      .map(({ index }) => index);
    expect(codeIndexes).toHaveLength(2);

    codeIndexes.forEach((index) => {
      expect(items[index - 1].type).toBe('qrcode');
      const expected = items[index - 1].content === TOKEN_A ? '123456' : '654321';
      expect(String(items[index].content).trim()).toBe(`PANEL CODE ${expected}`);
    });

    // And the old instruction line is gone entirely.
    expect(items.some((i) => String(i.content ?? '').includes('Type it on the school screen.'))).toBe(false);
  });
});
