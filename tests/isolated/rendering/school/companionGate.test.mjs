// tests/isolated/rendering/school/companionGate.test.mjs
//
// The gate row as INK and as a form map (Task 8).
//
// Two things have to hold at once and only paper can prove them together:
//
//  1. the row prints five positions labelled with the BARE upper-case letters
//     A–E — not "a.", not Ⓐ — because `decodeOmrSheet` reports `label ?? choice`
//     straight through to `codesMatch`, which is case-SENSITIVE. A decorative
//     label would fail every gate silently and read as a scanner fault;
//  2. the row's marks carry `selection: 'set'`, which is the only thing that
//     stops `decodeOmrSheet` calling a three-letter code an `ambiguous`
//     smudge. Nothing downstream could infer it from a mask — the PAPER is
//     what knows, so the renderer has to say so.
//
// The round trip below is the whole feature end to end on the bubble-sheet
// lane: render → bubble the minted code in with the virtual reader → decode →
// the same code comes back. Three shapes, chosen as the ones most likely to
// break: one letter (illegal as a `multi_select`, legal as a finish code),
// three letters, and all five.
import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';
import { decodeOmrSheet } from '#domains/school/documents/omrForm.mjs';
import { CODE_LETTERS, COMPANION_GATE_ITEM_ID } from '#domains/school/companionCode.mjs';

// The workbook theme, because that is what `RenderPrintDocument` renders every
// issued worksheet with — and it is the only theme carrying the `caption`
// style the gate row's instruction line is measured in.
const renderer = createDocumentPdfRenderer({ theme: createWorkbookTheme(), texToSvg });
const reader = new VirtualOmrReader({ logger: { info() {} } });

const gateQuestion = () => ({
  type: 'question',
  itemId: COMPANION_GATE_ITEM_ID,
  number: 1,
  omr: true,
  points: 0,
  companionGate: true,
  choices: [...CODE_LETTERS],
  blocks: [
    { type: 'rich_text', md: 'Fill in your read-along finish code.' },
    { type: 'omr_response', itemId: COMPANION_GATE_ITEM_ID, choices: 5 },
  ],
});

const plainQuestion = (n) => ({
  type: 'question',
  itemId: `q${n}`,
  number: n + 1,
  omr: true,
  blocks: [
    { type: 'rich_text', md: `Question ${n}?` },
    { type: 'omr_response', itemId: `q${n}`, choices: 4 },
  ],
});

const bankFor = (code) => ({
  id: 'test-bank',
  items: [
    {
      id: COMPANION_GATE_ITEM_ID,
      type: 'companion_code',
      prompt: 'Fill in your read-along finish code.',
      choices: [...CODE_LETTERS],
      code,
    },
    ...[1, 2].map((n) => ({
      id: `q${n}`,
      type: 'multiple_choice',
      choices: [`${n}/2`, `${n}/3`, `${n}/4`, `${n} 3/4`],
      answer: `${n}/2`,
    })),
  ],
});

const gateDocument = (blocks) => ({
  id: 'gate-doc', title: 'Gate Doc', seed: 909, variant: 0, target: ['letter'], blocks,
});

const marksFor = (formMap, itemId) => formMap.marks.filter((mark) => mark.itemId === itemId);

describe('the gate row prints its five letters', () => {
  it('draws exactly five positions, labelled A B C D E', async () => {
    const code = ['A', 'C', 'E'];
    const { formMap } = await renderer.render(
      gateDocument([gateQuestion(), plainQuestion(1)]),
      { bank: bankFor(code) },
    );

    const gate = marksFor(formMap, COMPANION_GATE_ITEM_ID);
    expect(gate).toHaveLength(5);
    expect(gate.map((mark) => mark.choice)).toEqual(['A', 'B', 'C', 'D', 'E']);
    // `decodeOmrSheet` reports `label ?? choice`; both have to be the canonical
    // letter or `codesMatch` — case-sensitive, A–E only — fails a right answer.
    expect(gate.map((mark) => mark.label)).toEqual(['A', 'B', 'C', 'D', 'E']);
    // One row: every bubble shares a baseline, which is what makes it one
    // reader column.
    expect(new Set(gate.map((mark) => mark.yPt)).size).toBe(1);
  });

  it('marks the gate row — and only the gate row — as set-valued', async () => {
    const { formMap } = await renderer.render(
      gateDocument([gateQuestion(), plainQuestion(1)]),
      { bank: bankFor(['B', 'D']) },
    );

    expect(marksFor(formMap, COMPANION_GATE_ITEM_ID).every((mark) => mark.selection === 'set')).toBe(true);
    expect(marksFor(formMap, 'q1').every((mark) => mark.selection === undefined)).toBe(true);
  });

  it('keeps the code out of the form map, which is persisted and read back at scan time', async () => {
    const { formMap } = await renderer.render(
      gateDocument([gateQuestion()]),
      { bank: bankFor(['A', 'C', 'E']) },
    );
    // A mark says WHERE a bubble is and WHICH letter it means. The answer is
    // not a coordinate, and the form map is not a place to keep one.
    expect(JSON.stringify(formMap)).not.toContain('"code"');
    expect(marksFor(formMap, COMPANION_GATE_ITEM_ID).every((mark) => mark.code === undefined)).toBe(true);
  });
});

describe('a rendered gate row round-trips a minted finish code', () => {
  it.each([
    ['a single letter', ['C']],
    ['three letters', ['A', 'C', 'E']],
    ['all five', ['A', 'B', 'C', 'D', 'E']],
  ])('%s', async (_label, code) => {
    const { formMap } = await renderer.render(
      gateDocument([gateQuestion(), plainQuestion(1), plainQuestion(2)]),
      { bank: bankFor(code) },
    );

    const sheet = reader.scanSheet({
      formMap,
      // Ordinary rows are bubbled by POSITION LETTER; they decode back to the
      // bank's choice TEXT, which is what grades. The gate is the exception
      // that proves it: its letters ARE its answer.
      chosen: { [COMPANION_GATE_ITEM_ID]: code, q1: 'A', q2: 'B' },
    });
    const decoded = decodeOmrSheet({ formMap, sheet });

    expect(decoded.errors).toEqual([]);
    // Not `ambiguous`: several marks in one row is this row's correct answer.
    expect(decoded.ambiguous).toEqual([]);
    expect(decoded.entries[COMPANION_GATE_ITEM_ID]).toEqual(code);
    // The ordinary rows are untouched by the gate's presence.
    expect(decoded.entries.q1).toBe('1/2');
  });

  it('reports a blank gate row as unanswered, not as an empty code', async () => {
    const { formMap } = await renderer.render(
      gateDocument([gateQuestion(), plainQuestion(1)]),
      { bank: bankFor(['A', 'C', 'E']) },
    );

    const sheet = reader.scanSheet({ formMap, chosen: { q1: 'A' }, blank: [COMPANION_GATE_ITEM_ID] });
    const decoded = decodeOmrSheet({ formMap, sheet });

    expect(decoded.blank).toEqual([COMPANION_GATE_ITEM_ID]);
    expect(decoded.entries[COMPANION_GATE_ITEM_ID]).toBeUndefined();
  });
});
