/**
 * Print Design Phase C, Task 4 — the card header strip (spec §5.2/§5.3): the
 * student number a student bubbles into OMR rows 1-7, printed below the document
 * header as large letter-spaced digits plus a "questions X-Y" range, and,
 * with no redundant instruction line beneath it.
 *
 * Same posture as `workbookAssessment.render.test.mjs` (Phase B's own
 * "measure + draw" suite, which this one mirrors): not a pixel golden suite
 * (`tests/isolated/rendering/school/golden/` stays pinned to
 * `documentPdfTheme` and untouched). Instead this pins the DETERMINISTIC,
 * structural output of measurement (`toMatchSnapshot()`) plus real end-to-end
 * PDF renders proving the new `cardHeader` node kind has a working draw pass.
 *
 * `true_false` rendering (this task's other rendering surface) has its own
 * describe block in `workbookAssessment.render.test.mjs`, mirroring the
 * multi_select precedent already there; card-option THREADING (byte-identity
 * when omitted, determinism) is covered end to end in
 * `tests/isolated/rendering/school/documentPdfRenderer.test.mjs`. This file
 * owns only the card header strip's own measured shape.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from './measure.mjs';
import { documentPdfTheme } from './documentPdfTheme.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const theme = createWorkbookTheme();
const renderer = createDocumentPdfRenderer({ theme, texToSvg });
/** Legacy renderer, no `theme.card` tokens — used only by the "guard" test below. */
const legacyRenderer = createDocumentPdfRenderer({ theme: documentPdfTheme, texToSvg });

const doc = (blocks, extra = {}) => ({
  id: 'workbook-card-test', title: 'Workbook Card Test', seed: 7, variant: 0, target: ['letter'], blocks, ...extra,
});

/** Measure a whole document's fragments (header [, cardHeader], ...body) through the real pipeline. */
function measureDoc(document, opts = {}) {
  const measurementDoc = createMeasurementDocument({ theme });
  return measureDocumentFragments(document, { doc: measurementDoc, theme, texToSvg, ...opts });
}

/** Wrapped-line runs never carry a literal space; rejoin them with one to read the words back out. */
function instructionText(instruction) {
  if (!instruction) return null;
  return instruction.lines.flatMap((l) => l.runs.map((r) => r.text)).join(' ');
}

function embeddedCardFragment(fragments) {
  const node = fragments[0]?.nodes?.[0]?.embeddedCard;
  if (!node) return null;
  return {
    id: 'cardHeader', atomic: true, spacingClass: theme.card.spacingClass,
    heightPt: node.heightPt, nodes: [node],
  };
}

/** Structural summariser, scoped to the fields a card-header fragment/node actually carries. */
function summarizeCardFragment(fragment) {
  const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const [node] = fragment.nodes;
  return {
    id: fragment.id,
    atomic: fragment.atomic,
    spacingClass: fragment.spacingClass,
    heightPt: round(fragment.heightPt),
    node: {
      kind: node.kind,
      cardId: node.cardId,
      digitCount: node.digits.length,
      digitChars: node.digits.map((d) => d.ch),
      // x offsets must be strictly increasing (letter-spaced, left to right,
      // never overlapping) — asserted separately below; snapshotted here as
      // rounded numbers so a tracking-token change shows up as an intentional
      // snapshot diff rather than silent drift.
      digitXOffsets: node.digits.map((d) => round(d.xPt)),
      labelText: node.labelText,
      metaText: node.metaText,
      firstUse: node.firstUse,
      reuseText: node.reuseText,
      identiconVersion: node.identicon.version,
      identiconCells: node.identicon.cells.map((cell) => (cell ? 1 : 0)).join(''),
      // Every card fragment carries exactly one instruction line (spec
      // §5.2) — its TEXT is the thing that varies with `firstUse`, not its
      // presence.
      instructionText: instructionText(node.instruction),
    },
  };
}

const bareDoc = doc([{ type: 'rich_text', md: 'Body content after the header.' }]);

describe('card header strip — measure (spec §5.2/§5.3)', () => {
  it('absent card option ⇒ no cardHeader fragment at all, byte-identical fragment list to before this feature existed', () => {
    const withoutCard = measureDoc(bareDoc);
    const withNullCard = measureDoc(bareDoc, { card: null });
    expect(withoutCard.map((f) => f.id)).toEqual(['header', 'blocks[0]#p0']);
    expect(withoutCard).toEqual(withNullCard);
  });

  it('a supplied card embeds one measured card header in the identity block above the title', () => {
    const fragments = measureDoc(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } });
    expect(fragments.map((f) => f.id)).toEqual(['header', 'blocks[0]#p0']);
    const cardFragment = embeddedCardFragment(fragments);
    expect(cardFragment.atomic).toBe(true);
    const [node] = cardFragment.nodes;
    expect(node.kind).toBe('cardHeader');
    expect(node.cardId).toBe('4829306');
    expect(node.digits).toHaveLength(7);
    expect(node.digits.map((d) => d.ch)).toEqual(['4', '8', '2', '9', '3', '0', '6']);
    expect(node.metaText).toBe('');
    expect(node.firstUse).toBe(false);
    // spec §5.2's non-first-use reminder: same cardId, but un-spaced (a
    // reference line, never a bubbling guide) — this is the literal digit string.
    expect(node.instruction).toBeNull();
  });

  it('stacks Name/Date above the card so the long KEEP banner cannot overlap either field', () => {
    const [headerFragment] = measureDoc(bareDoc, {
      card: { cardId: '4829306', startRow: 18, endRow: 30, firstUse: false },
      studentName: 'Workbook Learner',
    });
    const [header] = headerFragment.nodes;
    expect(header.metaRowHeightPt).toBeCloseTo(
      theme.header.metaLeadingPt + theme.header.metaCardGapPt + header.embeddedCard.heightPt,
      5,
    );
  });

  it('firstUse: false (the default) prints no redundant instruction', () => {
    const cardFragment = embeddedCardFragment(measureDoc(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30, firstUse: false } }));
    expect(cardFragment.nodes[0].instruction).toBeNull();
    expect(cardFragment.nodes[0].reuseText).toBe('KEEP USING THE SAME ANSWER SHEET · ROWS 18–30');
  });

  it('uses firstUse rather than startRow so a row-1 reprint says KEEP', () => {
    const reprint = embeddedCardFragment(measureDoc(bareDoc, {
      card: { cardId: '4829306', startRow: 1, endRow: 12, firstUse: false },
    }));
    const fresh = embeddedCardFragment(measureDoc(bareDoc, {
      card: { cardId: '4829306', startRow: 1, endRow: 12, firstUse: true },
    }));
    expect(reprint.nodes[0].reuseText).toBe('KEEP USING THE SAME ANSWER SHEET · ROWS 1–12');
    expect(fresh.nodes[0].reuseText).toBe('START A NEW ANSWER SHEET · ROWS 1–12');
    expect(reprint.nodes[0].identicon).toEqual(fresh.nodes[0].identicon);
  });

  it('digit x-offsets strictly increase left to right, each spaced by real glyph width + theme.card.trackingPt', () => {
    const cardFragment = embeddedCardFragment(measureDoc(bareDoc, { card: { cardId: '1234567', startRow: 1, endRow: 5 } }));
    const { digits } = cardFragment.nodes[0];
    for (let i = 1; i < digits.length; i += 1) {
      expect(digits[i].xPt).toBeGreaterThan(digits[i - 1].xPt);
      // The gap between two consecutive digit starts is at least the
      // previous digit's own width plus the theme's tracking token — proves
      // real measured glyph widths drive the offsets, not a fixed guess.
      expect(digits[i].xPt - digits[i - 1].xPt).toBeGreaterThanOrEqual(theme.card.trackingPt);
    }
  });

  it('firstUse does not add an instruction line', () => {
    const card = { cardId: '4829306', startRow: 18, endRow: 30 };
    const reminder = embeddedCardFragment(measureDoc(bareDoc, { card }));
    const firstUse = embeddedCardFragment(measureDoc(bareDoc, { card: { ...card, firstUse: true } }));
    expect(reminder.nodes[0].instruction).toBeNull();
    expect(firstUse.nodes[0].instruction).toBeNull();
    expect(firstUse.heightPt).toBeCloseTo(reminder.heightPt, 5);
  });

  it('a theme with no `card` token group (the legacy documentPdfTheme) refuses loudly rather than crashing on an undefined read', () => {
    const measurementDoc = createMeasurementDocument({ theme: documentPdfTheme });
    expect(() => measureDocumentFragments(bareDoc, {
      doc: measurementDoc,
      theme: documentPdfTheme,
      texToSvg,
      card: { cardId: '4829306', startRow: 18, endRow: 30 },
    })).toThrow('card rendering requires a theme with card tokens (workbook theme)');
  });

  it('structural snapshot — non-first-use reminder', () => {
    const cardFragment = embeddedCardFragment(measureDoc(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } }));
    expect(summarizeCardFragment(cardFragment)).toMatchSnapshot();
  });

  it('structural snapshot — first-use instruction present', () => {
    const cardFragment = embeddedCardFragment(measureDoc(bareDoc, {
      card: {
        cardId: '4829306', startRow: 1, endRow: 12, firstUse: true,
      },
    }));
    expect(summarizeCardFragment(cardFragment)).toMatchSnapshot();
  });
});

describe('card header strip — draw (real PDF)', () => {
  async function expectRealPdf(document, options = {}) {
    const { pdf, pageCount } = await renderer.render(document, { studentName: 'Workbook Learner', ...options });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBeGreaterThanOrEqual(1);
    return { pdf, pageCount };
  }

  it('renders a real PDF end to end with the card strip and the non-first-use "use your card" reminder', async () => {
    await expectRealPdf(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } });
  });

  it('renders a real PDF end to end with the first-use bubbling instruction line', async () => {
    await expectRealPdf(bareDoc, {
      card: {
        cardId: '4829306', startRow: 1, endRow: 12, firstUse: true,
      },
    });
  });

  it('a legacy-theme (documentPdfTheme) renderer refuses a card option instead of crashing raw', async () => {
    await expect(legacyRenderer.render(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } }))
      .rejects.toThrow('card rendering requires a theme with card tokens (workbook theme)');
  });

  it('is deterministic, like every other draw input', async () => {
    const card = { cardId: '4829306', startRow: 18, endRow: 30 };
    const first = await renderer.render(bareDoc, { card });
    const second = await renderer.render(bareDoc, { card });
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });

  it('a card-attached quiz lays out its body questions but prints NO on-page bubbles (formMap null)', async () => {
    const cardQuiz = doc([
      {
        type: 'question',
        itemId: 'q18',
        number: 18,
        blocks: [{ type: 'rich_text', md: 'Question eighteen.' }, { type: 'omr_response', itemId: 'q18', choices: 4 }],
      },
    ]);
    const bank = { id: 'card-bank', items: [{ id: 'q18', type: 'multiple_choice', choices: ['A', 'B', 'C', 'D'] }] };
    // Card-backed: the student marks the physical OMR card, so the sheet
    // withholds bubble ink and records no gradeable form map — while the
    // SAME document without a card still prints bubbles and a 4-mark map.
    const attached = await renderer.render(cardQuiz, {
      bank, card: { cardId: '4829306', startRow: 18, endRow: 18 },
    });
    expect(attached.formMap).toBeNull();
    const loose = await renderer.render(cardQuiz, { bank });
    expect(loose.formMap.marks).toHaveLength(4);
    // The withheld bubble is the ONLY difference — geometry is untouched, so
    // the card-backed page is strictly smaller, never re-laid-out.
    expect(attached.pageCount).toBe(loose.pageCount);
  });
});
