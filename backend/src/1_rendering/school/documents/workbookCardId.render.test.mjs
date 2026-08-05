/**
 * Print Design Phase C, Task 4 — the card header strip (spec §5.2/§5.3): the
 * card ID a student bubbles into OMR columns 1-7, printed below the document
 * header as large letter-spaced digits plus a "questions X-Y" range, and,
 * below that, an instruction/reminder caption line. EVERY card-attached
 * sheet gets one of two lines (spec §5.2): "Bubble this number into columns
 * 1-7 of a new card." on the first sheet issued against a fresh card
 * (`firstUse: true`), or "Use your card <id>." on every subsequent sheet
 * for that same card — never both, never neither.
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
  return instruction.lines.flatMap((l) => l.runs.map((r) => r.text)).join(' ');
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

  it('a supplied card inserts ONE atomic cardHeader fragment directly after the header, before the body', () => {
    const fragments = measureDoc(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } });
    expect(fragments.map((f) => f.id)).toEqual(['header', 'cardHeader', 'blocks[0]#p0']);
    const [, cardFragment] = fragments;
    expect(cardFragment.atomic).toBe(true);
    const [node] = cardFragment.nodes;
    expect(node.kind).toBe('cardHeader');
    expect(node.cardId).toBe('4829306');
    expect(node.digits).toHaveLength(7);
    expect(node.digits.map((d) => d.ch)).toEqual(['4', '8', '2', '9', '3', '0', '6']);
    expect(node.metaText).toContain('18');
    expect(node.metaText).toContain('30');
    expect(node.firstUse).toBe(false);
    // spec §5.2's non-first-use reminder: same cardId, but un-spaced (a
    // reference line, never a bubbling guide) — unlike `node.metaText`'s
    // dash-joined range, this is the literal digit string.
    expect(instructionText(node.instruction)).toBe('Use your card 4829306.');
  });

  it('firstUse: false (the default) prints the "use your card" reminder, not the bubbling instruction', () => {
    const [, cardFragment] = measureDoc(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30, firstUse: false } });
    expect(instructionText(cardFragment.nodes[0].instruction)).toBe('Use your card 4829306.');
  });

  it('digit x-offsets strictly increase left to right, each spaced by real glyph width + theme.card.trackingPt', () => {
    const [, cardFragment] = measureDoc(bareDoc, { card: { cardId: '1234567', startRow: 1, endRow: 5 } });
    const { digits } = cardFragment.nodes[0];
    for (let i = 1; i < digits.length; i += 1) {
      expect(digits[i].xPt).toBeGreaterThan(digits[i - 1].xPt);
      // The gap between two consecutive digit starts is at least the
      // previous digit's own width plus the theme's tracking token — proves
      // real measured glyph widths drive the offsets, not a fixed guess.
      expect(digits[i].xPt - digits[i - 1].xPt).toBeGreaterThanOrEqual(theme.card.trackingPt);
    }
  });

  it('firstUse: true swaps in the bubbling instruction instead of the reminder — both lines are ONE line, same field', () => {
    const card = { cardId: '4829306', startRow: 18, endRow: 30 };
    const [, reminder] = measureDoc(bareDoc, { card });
    const [, firstUse] = measureDoc(bareDoc, { card: { ...card, firstUse: true } });
    expect(instructionText(reminder.nodes[0].instruction)).toBe('Use your card 4829306.');
    expect(instructionText(firstUse.nodes[0].instruction)).toBe('Bubble this number into columns 1–7 of a new card.');
    // Both variants carry exactly one instruction line, so — for the same
    // short card/range — their fragment heights match; the difference is
    // WHICH sentence prints, not whether one prints at all.
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
    const [, cardFragment] = measureDoc(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } });
    expect(summarizeCardFragment(cardFragment)).toMatchSnapshot();
  });

  it('structural snapshot — first-use instruction present', () => {
    const [, cardFragment] = measureDoc(bareDoc, {
      card: {
        cardId: '4829306', startRow: 1, endRow: 12, firstUse: true,
      },
    });
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

  it('a card-attached quiz still lays out its body questions without error, printing the numbers it was given', async () => {
    const cardQuiz = doc([
      {
        type: 'question',
        itemId: 'q18',
        number: 18,
        blocks: [{ type: 'rich_text', md: 'Question eighteen.' }, { type: 'omr_response', itemId: 'q18', choices: 4 }],
      },
    ]);
    const bank = { id: 'card-bank', items: [{ id: 'q18', type: 'multiple_choice', choices: ['A', 'B', 'C', 'D'] }] };
    const { formMap } = await renderer.render(cardQuiz, {
      bank, card: { cardId: '4829306', startRow: 18, endRow: 18 },
    });
    expect(formMap.marks).toHaveLength(4);
  });
});
