/**
 * WHERE A PANEL CODE MAY APPEAR — one rule, asserted structurally.
 *
 * The six-digit panel code is the typable ALIAS for a scan token. It is only
 * meaningful as a fallback for the QR directly above it: "scan this, or if you
 * cannot, type this." A code printed anywhere else — mid-receipt, in a footer,
 * beside a note — is a number with no referent, and a child cannot tell which
 * of the day's offers it belongs to.
 *
 * So: EVERY `PANEL CODE` block must be immediately preceded by the
 * `scan_action` it aliases (or by the other half of its own pairing). This
 * suite walks whole documents from every builder rather than testing the
 * pairing helper in isolation, because the helper was never the risk — a new
 * caller appending a code somewhere else is.
 */
import { describe, it, expect } from 'vitest';
import { agendaDocument, resultDocument, noticeDocument } from '#domains/school/documents/receipts.mjs';

const CODE_RE = /^PANEL CODE (\d{6})$/;
const isCode = (b) => b?.type === 'rich_text' && CODE_RE.test(String(b.md ?? '').trim());
const isFollowUp = (b) => b?.type === 'rich_text' && String(b.md ?? '').trim() === 'Type it on the school screen.';

/**
 * Every code block, with what precedes it. A compliant document yields only
 * `scan_action` predecessors.
 */
function codePlacements(document) {
  const blocks = document.blocks ?? [];
  return blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => isCode(block))
    .map(({ block, index }) => ({
      code: String(block.md).trim(),
      precededBy: blocks[index - 1]?.type ?? null,
      followedBy: blocks[index + 1],
    }));
}

/** Codes appearing ANYWHERE in a document, however they were produced. */
function everyCodeLikeBlock(document) {
  return (document.blocks ?? []).filter((b) => (
    b?.type === 'rich_text' && /\b\d{6}\b/.test(String(b.md ?? ''))
  ));
}

const TOKEN_A = 'sch:2K7QVM4X9HRJTBNP';
const TOKEN_B = 'sch:9ZZZVM4X9HRJTBQQ';

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

  it('puts every panel code directly under its own scan_action', () => {
    const placements = codePlacements(agenda());
    expect(placements).toHaveLength(2);
    placements.forEach((p) => expect(p.precededBy).toBe('scan_action'));
  });

  it('keeps the two codes distinct and attached to their own offers', () => {
    const codes = codePlacements(agenda()).map((p) => p.code);
    expect(codes).toEqual(['PANEL CODE 123456', 'PANEL CODE 654321']);
  });

  it('pairs each code with its own follow-up line, never a stray one', () => {
    codePlacements(agenda()).forEach((p) => expect(isFollowUp(p.followedBy)).toBe(true));
  });

  it('prints NO code anywhere when none was minted', () => {
    const document = agenda({ accessCodesByToken: {} });
    expect(codePlacements(document)).toEqual([]);
    expect(everyCodeLikeBlock(document)).toEqual([]);
  });

  it('does not attach a code to a grown-up note, which carries no scan_action', () => {
    const document = agenda({ notes: ['Check question 7 again.'] });
    codePlacements(document).forEach((p) => expect(p.precededBy).toBe('scan_action'));
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

  it('puts the next-up code directly under the next-up QR', () => {
    const placements = codePlacements(result());
    expect(placements).toHaveLength(1);
    expect(placements[0].precededBy).toBe('scan_action');
  });

  it('prints no code at all on a result whose action never minted one', () => {
    const document = result({ actions: [{ token: TOKEN_A, label: 'Michigan', presentation: 'lesson' }] });
    expect(codePlacements(document)).toEqual([]);
  });

  it('says scanning is the only way in rather than printing a bare number', () => {
    // The tri-state: an explicitly NULL code means "there is no typable
    // alias", which must be said in words — never as an empty PANEL CODE line.
    const document = result({
      actions: [{ token: TOKEN_A, label: 'Michigan', accessCode: null, presentation: 'lesson' }],
    });
    expect(codePlacements(document)).toEqual([]);
    const text = (document.blocks ?? []).map((b) => String(b.md ?? '')).join('\n');
    expect(text).toContain('Scanning is the only way in.');
  });
});

describe('notice receipts', () => {
  it('places a code under its scan_action, or prints none', () => {
    const document = noticeDocument({
      title: 'Nothing to do',
      lines: ['Come back tomorrow.'],
      actions: [{ token: TOKEN_A, label: 'Try again', accessCode: '111111' }],
    });
    codePlacements(document).forEach((p) => expect(p.precededBy).toBe('scan_action'));
  });
});

/**
 * The same rule at the RENDERER, not just the builder. A compliant block
 * stream can still be reordered on its way to paper, and the text renderer is
 * what the printer's operator transcript is harvested from — a code that
 * drifts away from its QR there is a code with no referent in the record too.
 */
describe('the text renderer keeps each code with its own QR', () => {
  it('emits PANEL CODE immediately after the qrcode it aliases', async () => {
    const { createDocumentEscPosRenderer } = await import('#rendering/school/documents/DocumentEscPosRenderer.mjs');
    const document = agendaDocument({
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
    const { items } = createDocumentEscPosRenderer({ symbology: 'QR' }).render(document);

    const codeIndexes = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => CODE_RE.test(String(item.content ?? '').trim()))
      .map(({ index }) => index);
    expect(codeIndexes).toHaveLength(2);

    codeIndexes.forEach((index) => {
      expect(items[index - 1].type).toBe('qrcode');
      // ...and aliasing THAT qr's token, not the other offer's.
      const expected = items[index - 1].content === TOKEN_A ? '123456' : '654321';
      expect(String(items[index].content).trim()).toBe(`PANEL CODE ${expected}`);
    });
  });
});
