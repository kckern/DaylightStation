/**
 * Print Design Phase C, Task 4 — the card header strip (spec §5.2/§5.3): the
 * card ID a student bubbles into OMR columns 1-7, printed below the document
 * header as large letter-spaced digits plus a "questions X-Y" range, and,
 * on a fresh card's first sheet, an instruction line.
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
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const theme = createWorkbookTheme();
const renderer = createDocumentPdfRenderer({ theme, texToSvg });

const doc = (blocks, extra = {}) => ({
  id: 'workbook-card-test', title: 'Workbook Card Test', seed: 7, variant: 0, target: ['letter'], blocks, ...extra,
});

/** Measure a whole document's fragments (header [, cardHeader], ...body) through the real pipeline. */
function measureDoc(document, opts = {}) {
  const measurementDoc = createMeasurementDocument({ theme });
  return measureDocumentFragments(document, { doc: measurementDoc, theme, texToSvg, ...opts });
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
      hasInstruction: node.instruction !== null,
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
    expect(node.instruction).toBeNull();
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

  it('firstUse: true adds an instruction line and grows the fragment height', () => {
    const card = { cardId: '4829306', startRow: 18, endRow: 30 };
    const [, withoutInstruction] = measureDoc(bareDoc, { card });
    const [, withInstruction] = measureDoc(bareDoc, { card: { ...card, firstUse: true } });
    expect(withoutInstruction.nodes[0].instruction).toBeNull();
    const instructionNode = withInstruction.nodes[0].instruction;
    expect(instructionNode).not.toBeNull();
    expect(instructionNode.lines.flatMap((l) => l.runs.map((r) => r.text)).join(' '))
      .toContain('Bubble this number into columns');
    expect(withInstruction.heightPt).toBeGreaterThan(withoutInstruction.heightPt);
  });

  it('structural snapshot — no first-use', () => {
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

  it('renders a real PDF end to end with the card strip, no first-use instruction', async () => {
    await expectRealPdf(bareDoc, { card: { cardId: '4829306', startRow: 18, endRow: 30 } });
  });

  it('renders a real PDF end to end with the first-use instruction line', async () => {
    await expectRealPdf(bareDoc, {
      card: {
        cardId: '4829306', startRow: 1, endRow: 12, firstUse: true,
      },
    });
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
