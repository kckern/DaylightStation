/**
 * Print Design Phase B, Task 4 — measure + draw for the assessment blocks
 * (wordbank, matching, cloze, short_answer, essay) plus multi_select's
 * checkbox/instruction rendering and the quiz header's score box, all under
 * `workbookTheme`.
 *
 * Same posture as `workbookBlocks.render.test.mjs` (Task 5's content-block
 * suite, which this one mirrors): not a pixel golden suite — that machinery
 * (`tests/isolated/rendering/school/golden/`) is pinned to `documentPdfTheme`
 * and stays untouched. Instead this pins the DETERMINISTIC, structural output
 * of measurement (`toMatchSnapshot()`, a Vitest golden file committed beside
 * this suite) plus real end-to-end PDF renders proving every new node kind
 * has a working draw pass.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import {
  createMeasurementDocument, measureBlocks, measureDocumentFragments,
} from './measure.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const theme = createWorkbookTheme();

const STUB_SVG = '<svg viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="80" fill="#000"/></svg>';
const resolveAsset = (ref) => (ref === 'school/art/leaf' ? { svg: STUB_SVG, widthPt: 200, heightPt: 100 } : null);

const renderer = createDocumentPdfRenderer({ theme, texToSvg, resolveAsset });

const doc = (blocks, extra = {}) => ({
  id: 'workbook-assessment-test', title: 'Workbook Assessment', seed: 99, variant: 0, target: ['letter'], blocks, ...extra,
});

/**
 * Wrapped-line runs never carry literal space characters — a word-wrap word
 * boundary is implied by the gap between two pieces' `xPt`, not a space in
 * `run.text` (see measure.mjs's `tokenizeRuns`). Reconstructing readable text
 * for an assertion means rejoining every run with a single space.
 */
function linesToText(lines) {
  if (!lines) return null;
  return lines.map((line) => line.runs.map((run) => run.text).join(' ')).join(' ');
}

/** Measure a single block through the real pipeline, no PDF bytes produced. */
function measureOne(block, opts = {}) {
  const measurementDoc = createMeasurementDocument({ theme });
  return measureBlocks([block], {
    doc: measurementDoc, theme, texToSvg, resolveAsset, ...opts,
  });
}

/** Same structural summariser as workbookBlocks.render.test.mjs, extended with the new node kinds. */
function summarizeFragment(fragment) {
  const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const summarizeNode = (node) => {
    const { kind } = node;
    const base = { kind, heightPt: round(node.heightPt), widthPt: round(node.widthPt) };
    if (kind === 'text') {
      return {
        ...base,
        styleKey: node.styleKey,
        lineCount: node.lines.length,
        // Flags whether ANY line carries a cloze blank atom, without pinning
        // exact pdfkit-measured widths (jitter-prone across font versions).
        hasBlank: node.lines.some((line) => line.runs.some((run) => run.kind === 'blank')),
      };
    }
    if (kind === 'answerSpace') return { ...base, minPt: round(node.minPt), maxPt: round(node.maxPt) };
    if (kind === 'box') {
      return {
        ...base, radiusPt: node.radiusPt, paddingPt: node.paddingPt, childKinds: node.childNodes.map((c) => c.kind),
      };
    }
    if (kind === 'wordbank') {
      return {
        ...base, rowCount: node.rows.length, terms: node.rows.flat().map((t) => t.text),
      };
    }
    if (kind === 'matching') {
      return {
        ...base,
        leftNumbers: node.left.map((i) => i.number),
        rightLetters: node.right.map((i) => i.letter),
      };
    }
    if (kind === 'omr') {
      return {
        ...base,
        multiSelect: node.multiSelect,
        instructionText: linesToText(node.instruction?.lines) ?? null,
        choiceLetters: node.cells.map((c) => c.choice),
      };
    }
    return base;
  };
  return {
    id: fragment.id,
    atomic: fragment.atomic,
    spacingClass: fragment.spacingClass,
    styleKey: fragment.styleKey,
    heightPt: round(fragment.heightPt),
    // Flowable (`kind: 'text'`) fragments carry `.lines` directly, never
    // `.nodes` — see measure.mjs's `fragmentFromNode`. Surfaced here so a
    // cloze/prompt fragment's snapshot actually shows what it measured,
    // rather than a blank `nodes: undefined`.
    lineCount: fragment.lines?.length,
    hasBlank: fragment.lines?.some((line) => line.runs.some((run) => run.kind === 'blank')),
    nodeKinds: fragment.nodes?.map((n) => n.kind),
    nodes: fragment.nodes?.map(summarizeNode),
    answerSpace: fragment.answerSpace
      ? { minPt: round(fragment.answerSpace.minPt), maxPt: round(fragment.answerSpace.maxPt) }
      : null,
  };
}

async function expectRealPdf(document, options = {}) {
  const { pdf, pageCount } = await renderer.render(document, { studentName: 'Workbook Learner', ...options });
  expect(Buffer.isBuffer(pdf)).toBe(true);
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pageCount).toBeGreaterThanOrEqual(1);
  expect(pdf.toString('latin1').match(/\(D:\d{14}Z?\)/g)).toEqual(['(D:19700101000000Z)']);
  return { pdf, pageCount };
}

describe('workbook assessment blocks — measure + draw', () => {
  describe('wordbank', () => {
    const block = { type: 'wordbank', key: 'wb1', terms: ['Photosynthesis', 'Mitosis', 'Osmosis', 'Respiration'] };

    it('measures ONE atomic wordbank fragment, boxed via theme.box, terms in the order given', () => {
      const [fragment] = measureOne(block);
      expect(fragment.atomic).toBe(true);
      const [node] = fragment.nodes;
      expect(node.kind).toBe('wordbank');
      expect(node.paddingPt).toBe(theme.box.paddingPt);
      expect(node.radiusPt).toBe(theme.box.radiusPt);
      expect(node.rows.flat().map((t) => t.text)).toEqual(block.terms);
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('wraps to a new row when terms overrun the box width', () => {
      const longTerms = Array.from({ length: 20 }, (_, i) => `Vocabulary Term Number ${i + 1}`);
      const [fragment] = measureOne({ type: 'wordbank', key: 'wb2', terms: longTerms });
      const [node] = fragment.nodes;
      expect(node.rows.length).toBeGreaterThan(1);
      expect(node.rows.flat().map((t) => t.text)).toEqual(longTerms);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([block]));
    });
  });

  describe('matching', () => {
    const block = {
      type: 'matching',
      key: 'm1',
      left: ['Photosynthesis', 'Mitosis'],
      right: ['Cell division', 'Making food from light'],
    };

    it('measures ONE atomic matching fragment — left numbered 1..n, right lettered A..n', () => {
      const [fragment] = measureOne(block);
      expect(fragment.atomic).toBe(true);
      const [node] = fragment.nodes;
      expect(node.kind).toBe('matching');
      expect(node.left.map((i) => i.number)).toEqual([1, 2]);
      expect(node.right.map((i) => i.letter)).toEqual(['A', 'B']);
      // A block-internal two-column layout, not the generic columns
      // container: both columns are nodes INSIDE this one node/fragment.
      expect(fragment.nodes).toHaveLength(1);
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('handles uneven left/right counts without crashing', () => {
      const [fragment] = measureOne({
        type: 'matching', key: 'm2', left: ['A', 'B', 'C'], right: ['1', '2'],
      });
      const [node] = fragment.nodes;
      expect(node.left).toHaveLength(3);
      expect(node.right).toHaveLength(2);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([block]));
    });
  });

  describe('cloze', () => {
    const block = {
      type: 'cloze',
      text: 'The powerhouse of the cell is the {{1}}, and photosynthesis happens in the {{2}}.',
      blanks: [{ n: 1, width: 's' }, { n: 2, width: 'm', wordbank: 'wb1' }],
    };

    it('measures a flowable text fragment whose blanks are unbreakable inline atoms sized from theme.blank', () => {
      const [fragment] = measureOne(block);
      expect(fragment.atomic).toBe(false);
      const blankRuns = fragment.lines.flatMap((l) => l.runs).filter((r) => r.kind === 'blank');
      expect(blankRuns.map((r) => r.n)).toEqual([1, 2]);
      expect(blankRuns[0].widthPt).toBe(theme.blank.s);
      expect(blankRuns[1].widthPt).toBe(theme.blank.m);
      // Every other word on the line is real text — the blank stands ALONE,
      // never merged with a neighbouring word's font/text.
      expect(blankRuns.every((r) => r.text === undefined)).toBe(true);
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('defaults an unwidthed blank to the medium size class', () => {
      const [fragment] = measureOne({
        type: 'cloze', text: 'Pick {{1}}.', blanks: [{ n: 1 }],
      });
      const [blankRun] = fragment.lines.flatMap((l) => l.runs).filter((r) => r.kind === 'blank');
      expect(blankRun.widthPt).toBe(theme.blank.m);
    });

    it('a blank never breaks across lines even when it lands at a wrap boundary', () => {
      // Long lead-in text designed to push the blank right up against the
      // wrap width; measurement must still place the WHOLE blank on one line
      // (or push it whole to the next), never split it.
      const longLead = 'Word '.repeat(40);
      const [fragment] = measureOne({
        type: 'cloze', text: `${longLead}{{1}} end.`, blanks: [{ n: 1, width: 'l' }],
      });
      const blankLines = fragment.lines.filter((l) => l.runs.some((r) => r.kind === 'blank'));
      expect(blankLines).toHaveLength(1);
      const [blankRun] = blankLines[0].runs.filter((r) => r.kind === 'blank');
      expect(blankRun.xPt + blankRun.widthPt).toBeLessThanOrEqual(blankLines[0].widthPt + 0.01);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([block]));
    });
  });

  describe('short_answer', () => {
    it('desugars to a prompt text node + a ruled answer_space node, sized from the default line count', () => {
      const [promptFragment, spaceFragment] = measureOne({ type: 'short_answer', prompt: 'Name a primary color.' });
      // A `text`-kind node's fragment is flowable — its lines live at
      // `fragment.lines` directly, not nested under `fragment.nodes` (see
      // measure.mjs's `fragmentFromNode`'s `kind === 'text'` branch).
      expect(promptFragment.atomic).toBe(false);
      expect(promptFragment.lines.length).toBeGreaterThan(0);
      expect(spaceFragment.nodes[0].kind).toBe('answerSpace');
      const expectedMinPt = theme.answerSpace.padAbovePt + theme.shortAnswer.defaultLines * theme.answerSpace.rulePitchPt;
      expect(spaceFragment.nodes[0].minPt).toBeCloseTo(expectedMinPt, 5);
      expect(spaceFragment.nodes[0].maxPt).toBeCloseTo(expectedMinPt, 5);
      // F4 (review finding): the prompt fragment carries keep-with-next
      // affinity to its own write-space fragment (layout.mjs's
      // `stickToNextId`) — see layout.test.mjs for the placement-level proof
      // that this actually stops the two from stranding across a page break.
      expect(promptFragment.stickToNextId).toBe(spaceFragment.id);
      expect([promptFragment, spaceFragment].map(summarizeFragment)).toMatchSnapshot();
    });

    it('an explicit `lines` count overrides the default', () => {
      const [, spaceFragment] = measureOne({ type: 'short_answer', prompt: 'Explain.', lines: 6 });
      const expectedMinPt = theme.answerSpace.padAbovePt + 6 * theme.answerSpace.rulePitchPt;
      expect(spaceFragment.nodes[0].minPt).toBeCloseTo(expectedMinPt, 5);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([{ type: 'short_answer', prompt: 'Name a primary color.' }]));
    });
  });

  describe('essay', () => {
    it('without `box`, desugars to a prompt + ruled answer_space (same mechanics as short_answer)', () => {
      const [, spaceFragment] = measureOne({ type: 'essay', prompt: 'Describe your day.' });
      expect(spaceFragment.nodes[0].kind).toBe('answerSpace');
      const expectedMinPt = theme.answerSpace.padAbovePt + theme.essay.defaultLines * theme.answerSpace.rulePitchPt;
      expect(spaceFragment.nodes[0].minPt).toBeCloseTo(expectedMinPt, 5);
    });

    it('`box: true` desugars to a prompt + an OPEN box (theme.box chrome, no ruled lines, no children)', () => {
      const [promptFragment, boxFragment] = measureOne({ type: 'essay', prompt: 'Draw and describe.', box: true });
      expect(promptFragment.atomic).toBe(false);
      expect(promptFragment.lines.length).toBeGreaterThan(0);
      const [boxNode] = boxFragment.nodes;
      expect(boxNode.kind).toBe('box');
      expect(boxNode.childNodes).toEqual([]);
      expect(boxNode.heightPt).toBe(theme.essay.boxHeightPt);
      expect(boxNode.radiusPt).toBe(theme.box.radiusPt);
      // F4: the box variant gets the SAME keep-with-next affinity as the
      // ruled-lines variant above — a prompt must not strand from an open
      // answer box any more than from ruled lines.
      expect(promptFragment.stickToNextId).toBe(boxFragment.id);
      expect([promptFragment, boxFragment].map(summarizeFragment)).toMatchSnapshot();
    });

    it('renders a real PDF end to end for both variants', async () => {
      await expectRealPdf(doc([
        { type: 'essay', prompt: 'Describe your day.' },
        { type: 'essay', prompt: 'Draw and describe.', box: true },
      ]));
    });
  });

  describe('multi_select — square checkboxes + instruction line on an omr_response row', () => {
    const question = {
      type: 'question', itemId: 'ms-q1', number: 1, blocks: [{ type: 'rich_text', md: 'Which are prime numbers?' }],
    };
    const omrBlock = { ...question, blocks: [...question.blocks, { type: 'omr_response', itemId: 'ms-q1', choices: 4 }] };

    const multiSelectResolver = (itemId, { choices }) => ({
      labels: Array.from({ length: choices }, (_, i) => `Option ${i + 1}`),
      multiSelect: true,
      maxSelect: 2,
    });
    const markAllResolver = (itemId, { choices }) => ({
      labels: Array.from({ length: choices }, (_, i) => `Option ${i + 1}`),
      multiSelect: true,
    });
    const legacyResolver = (itemId, { choices }) => Array.from({ length: choices }, (_, i) => `Option ${i + 1}`);

    it('a multi_select resolution measures square checkboxes and a "Choose up to N." instruction', () => {
      const [fragment] = measureOne(omrBlock, { resolveChoices: multiSelectResolver });
      const omrNode = fragment.nodes.find((n) => n.kind === 'omr');
      expect(omrNode.multiSelect).toBe(true);
      expect(omrNode.instruction).not.toBeNull();
      const instructionText = linesToText(omrNode.instruction.lines);
      expect(instructionText).toBe('Choose up to 2.');
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('no maxSelect ⇒ "Mark all that apply."', () => {
      const [fragment] = measureOne(omrBlock, { resolveChoices: markAllResolver });
      const omrNode = fragment.nodes.find((n) => n.kind === 'omr');
      const instructionText = linesToText(omrNode.instruction.lines);
      expect(instructionText).toBe('Mark all that apply.');
    });

    it('an ordinary (non-multi_select) resolution is UNCHANGED: no instruction, multiSelect false', () => {
      const [fragment] = measureOne(omrBlock, { resolveChoices: legacyResolver });
      const omrNode = fragment.nodes.find((n) => n.kind === 'omr');
      expect(omrNode.multiSelect).toBe(false);
      expect(omrNode.instruction).toBeNull();
    });

    it('renders a real PDF end to end for a multi_select row', async () => {
      const bank = { id: 'ms-bank', items: [{
        id: 'ms-q1', type: 'multi_select', choices: ['2', '3', '4', '5'], answers: ['2', '3', '5'], maxSelect: 2,
      }] };
      await expectRealPdf(doc([omrBlock]), { bank });
    });
  });

  describe('true_false — Ⓐ True / Ⓑ False circle bubbles on an omr_response row (Phase C, Task 4, spec §5.2/§5.3)', () => {
    const question = {
      type: 'question', itemId: 'tf-q1', number: 1, blocks: [{ type: 'rich_text', md: 'The sky is blue.' }],
    };
    const omrBlock = { ...question, blocks: [...question.blocks, { type: 'omr_response', itemId: 'tf-q1', choices: 2 }] };

    // The exact resolution `createChoiceResolver` (DocumentPdfRenderer.mjs)
    // synthesizes for a true_false bank item: a BARE array, never the
    // `{labels, multiSelect}` shape — so this measures identically to an
    // ordinary 2-choice multiple_choice row.
    const trueFalseResolver = () => ['True', 'False'];

    it('measures ordinary circle bubbles — multiSelect false, no instruction, letters A/B, labels True/False', () => {
      const [fragment] = measureOne(omrBlock, { resolveChoices: trueFalseResolver });
      const omrNode = fragment.nodes.find((n) => n.kind === 'omr');
      expect(omrNode.multiSelect).toBe(false);
      expect(omrNode.instruction).toBeNull();
      expect(omrNode.cells.map((c) => c.choice)).toEqual(['A', 'B']);
      expect(omrNode.cells.map((c) => c.label)).toEqual(['True', 'False']);
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('renders a real PDF end to end for a true_false row, resolved straight from the bank', async () => {
      const bank = { id: 'tf-bank', items: [{ id: 'tf-q1', type: 'true_false', answer: true }] };
      const { formMap } = await renderer.render(doc([omrBlock]), { bank });
      expect(formMap.marks.map((m) => m.label)).toEqual(['True', 'False']);
    });
  });

  describe('score box (quiz header)', () => {
    function measureHeader({ headerConfig, totalPoints } = {}) {
      const measurementDoc = createMeasurementDocument({ theme });
      const document = {
        id: 'quiz-doc', title: 'Quiz', seed: 1, variant: 0, target: ['letter'], blocks: [],
      };
      const [header] = measureDocumentFragments(document, {
        doc: measurementDoc, theme, texToSvg, resolveAsset, header: headerConfig, totalPoints,
      });
      return header;
    }

    it('header.scoreBox + totalPoints renders "Score ____ / N" and grows the banner height', () => {
      const withoutScore = measureHeader({ headerConfig: { scoreBox: false } });
      const withScore = measureHeader({ headerConfig: { scoreBox: true }, totalPoints: 20 });
      const [node] = withScore.nodes;
      expect(node.showScoreBox).toBe(true);
      expect(node.totalPoints).toBe(20);
      expect(withScore.heightPt).toBeGreaterThan(withoutScore.heightPt);
      expect(summarizeFragment(withScore)).toMatchSnapshot();
    });

    it('header.scoreBox true but NO totalPoints supplied prints no score line (caller threads the total, Task 5)', () => {
      const header = measureHeader({ headerConfig: { scoreBox: true } });
      expect(header.nodes[0].showScoreBox).toBe(false);
      expect(header.nodes[0].totalPoints).toBeNull();
    });

    it('scoreBox false ignores a supplied totalPoints', () => {
      const header = measureHeader({ headerConfig: { scoreBox: false }, totalPoints: 20 });
      expect(header.nodes[0].showScoreBox).toBe(false);
    });

    it('renders a real PDF end to end with a visible score line', async () => {
      const document = doc([{ type: 'rich_text', md: 'Question content.' }], {
        header: { scoreBox: true, name: true, date: true },
      });
      await expectRealPdf(document, { totalPoints: 25 });
    });
  });

  describe('everything together', () => {
    it('composes all five assessment blocks plus a multi_select row into one document without a layout error', async () => {
      const bank = { id: 'combo-bank', items: [{
        id: 'combo-q1', type: 'multi_select', choices: ['A', 'B', 'C'], answers: ['A', 'C'],
      }] };
      const { pageCount } = await expectRealPdf(doc([
        { type: 'wordbank', key: 'combo-wb', terms: ['Alpha', 'Beta', 'Gamma'] },
        {
          type: 'matching', key: 'combo-m', left: ['Alpha', 'Beta'], right: ['1', '2'],
        },
        {
          type: 'cloze', text: 'The {{1}} comes before the {{2}}.', blanks: [{ n: 1 }, { n: 2 }],
        },
        { type: 'short_answer', prompt: 'Name a letter.' },
        { type: 'essay', prompt: 'Describe the alphabet.', box: true },
        {
          type: 'question',
          itemId: 'combo-q1',
          number: 1,
          blocks: [{ type: 'rich_text', md: 'Which are vowels?' }, { type: 'omr_response', itemId: 'combo-q1', choices: 3 }],
        },
      ], { header: { scoreBox: true, name: true, date: true } }), { bank, totalPoints: 10 });
      expect(pageCount).toBeGreaterThanOrEqual(1);
    });
  });
});
