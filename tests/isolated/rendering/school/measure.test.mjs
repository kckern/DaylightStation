/**
 * Block measurers — the bridge from validated blocks to layout fragments.
 *
 * texToSvg is stubbed in most cases (measurement only cares about the numbers
 * it returns, and MathJax is slow to boot); probeDocument tests use the real
 * one, because the whole point of the publish gate is that bad TeX fails there.
 */
import { describe, it, expect } from 'vitest';
import {
  measureBlocks,
  measureDocumentFragments,
  createMeasurementDocument,
  probeDocument,
  UnsupportedBlockError,
} from '#rendering/school/documents/measure.mjs';
import { documentPdfTheme as theme } from '#rendering/school/documents/documentPdfTheme.mjs';

const CONTENT_WIDTH = theme.page.widthPt - 2 * theme.page.marginPt;

/** Deterministic stand-in for MathJax: 6pt of width per character, 1.4em tall. */
function stubTexToSvg(tex, { fontSizePt = 12 } = {}) {
  return {
    svgString: `<svg viewBox="0 -1000 ${tex.length * 500} 1400"><g/></svg>`,
    widthPt: tex.length * 6,
    heightPt: fontSizePt * 1.4,
    depthPt: fontSizePt * 0.4,
  };
}

function measure(blocks, { texToSvg = stubTexToSvg, resolveAsset = null } = {}) {
  const doc = createMeasurementDocument({ theme });
  return measureBlocks(blocks, { doc, theme, texToSvg, resolveAsset });
}

const totalHeight = (nodes) => nodes.reduce((max, n) => Math.max(max, n.offsetYPt + n.heightPt), 0);

describe('documentPdfTheme', () => {
  it('carries a full spacing gap for every ordered class pair', () => {
    const classes = Object.keys(theme.spacing);
    for (const from of classes) {
      for (const to of classes) {
        expect(typeof theme.spacing[from][to], `spacing.${from}.${to}`).toBe('number');
      }
    }
  });

  it('is US Letter with 54pt margins', () => {
    expect(theme.page).toMatchObject({ widthPt: 612, heightPt: 792, marginPt: 54 });
  });
});

describe('measureBlocks — rich_text', () => {
  it('splits a markdown heading and its paragraph into separate fragments', () => {
    const fragments = measure([
      { type: 'rich_text', md: '## Fractions Practice\n\nWork each problem on this page.' },
    ]);
    expect(fragments).toHaveLength(2);
    expect(fragments[0].spacingClass).toBe('heading');
    expect(fragments[1].spacingClass).toBe('body');
  });

  it('produces flowable fragments with per-line heights for widow/orphan control', () => {
    const [fragment] = measure([{ type: 'rich_text', md: 'One short line.' }]);
    expect(fragment.atomic).toBe(false);
    expect(Array.isArray(fragment.lines)).toBe(true);
    expect(fragment.lines[0].heightPt).toBe(theme.styles.body.leadingPt);
    expect(fragment.minLinesBeforeBreak).toBe(theme.widowOrphan.minLinesBeforeBreak);
    expect(fragment.minLinesAfterBreak).toBe(theme.widowOrphan.minLinesAfterBreak);
  });

  it('wraps a long paragraph to several lines, none wider than the content width', () => {
    const md = 'Rewrite both fractions with a common denominator before you compare them, '
      + 'then write the comparison symbol in the box and check your work by drawing a strip diagram.';
    const [fragment] = measure([{ type: 'rich_text', md }]);
    expect(fragment.lines.length).toBeGreaterThan(1);
    expect(fragment.heightPt).toBeCloseTo(fragment.lines.length * theme.styles.body.leadingPt, 6);
    for (const line of fragment.lines) {
      expect(line.widthPt).toBeLessThanOrEqual(CONTENT_WIDTH);
    }
  });

  it('keeps bold spans as separate runs so the draw pass can switch fonts', () => {
    const [fragment] = measure([{ type: 'rich_text', md: 'Write it in **simplest form** now.' }]);
    const runs = fragment.lines.flatMap((line) => line.runs);
    expect(runs.some((r) => r.font === 'bold' && r.text.includes('simplest'))).toBe(true);
    expect(runs.every((r) => !r.text.includes('*'))).toBe(true);
  });

  it('renders inline $math$ as its own display-math fragment (v1 deferral)', () => {
    const fragments = measure([{ type: 'rich_text', md: 'Simplify $\\frac{1}{2}$ now.' }]);
    const kinds = fragments.map((f) => f.nodes?.[0]?.kind ?? 'text');
    expect(kinds).toEqual(['text', 'math', 'text']);
    // The `$` delimiters are consumed, never drawn (the source block stays
    // attached to the fragment for provenance, so only drawn text is checked).
    const drawnWords = fragments.flatMap((f) => (f.lines ?? []).flatMap((l) => l.runs.map((r) => r.text)));
    expect(drawnWords.join(' ')).toBe('Simplify now.');
  });
});

describe('measureBlocks — questions', () => {
  const question = {
    type: 'question',
    itemId: 'u2-q1',
    number: 1,
    blocks: [
      { type: 'rich_text', md: 'Add. Write the result in simplest form.' },
      { type: 'math', tex: '\\frac{2}{3} + \\frac{1}{4}', display: true },
      { type: 'answer_space', minPt: 54, maxPt: 90 },
    ],
  };

  it('collapses a question and everything nested in it into ONE atomic fragment', () => {
    const fragments = measure([question]);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].atomic).toBe(true);
    expect(fragments[0].spacingClass).toBe('question');
    expect(fragments[0].nodes.map((n) => n.kind)).toEqual(['text', 'math', 'answerSpace']);
    expect(fragments[0].heightPt).toBeCloseTo(totalHeight(fragments[0].nodes), 6);
  });

  it('carries the nested answer space through as fragment growth headroom', () => {
    const [fragment] = measure([question]);
    expect(fragment.answerSpace.minPt).toBeCloseTo(fragment.heightPt, 6);
    expect(fragment.answerSpace.maxPt - fragment.answerSpace.minPt).toBeCloseTo(90 - 54, 6);
    expect(fragment.baseHeightPt).toBeCloseTo(fragment.heightPt, 6);
  });

  it('measures nested content against the width left by the number gutter', () => {
    const wide = { ...question, blocks: [question.blocks[0]] };
    const [nested] = measure([wide]);
    const [loose] = measure([question.blocks[0]]);
    expect(nested.nodes[0].widthPt).toBeCloseTo(CONTENT_WIDTH - theme.question.numberGutterPt, 6);
    expect(loose.widthPt).toBeCloseTo(CONTENT_WIDTH, 6);
  });

  it('measures an omr_response row from the theme bubble geometry', () => {
    const [fragment] = measure([{
      ...question,
      blocks: [{ type: 'omr_response', itemId: 'u2-q1', choices: 4 }],
    }]);
    const node = fragment.nodes[0];
    expect(node.kind).toBe('omr');
    expect(node.choices).toBe(4);
    expect(node.heightPt).toBe(theme.omr.rowHeightPt);
  });
});

describe('measureBlocks — math, assets and actions', () => {
  it('measures display math through the injected texToSvg', () => {
    const calls = [];
    const spy = (tex, opts) => { calls.push({ tex, opts }); return stubTexToSvg(tex, opts); };
    const [fragment] = measure([{ type: 'math', tex: 'x+1', display: true }], { texToSvg: spy });
    expect(calls[0].opts.display).toBe(true);
    expect(calls[0].opts.fontSizePt).toBe(theme.math.fontSizePt);
    expect(fragment.nodes[0].heightPt)
      .toBeCloseTo(theme.math.fontSizePt * 1.4 + theme.math.padAbovePt + theme.math.padBelowPt, 6);
  });

  it('scales oversized math down instead of letting it run past the margin', () => {
    const huge = () => ({ svgString: '<svg viewBox="0 0 10 10"/>', widthPt: 2000, heightPt: 100, depthPt: 0 });
    const [fragment] = measure([{ type: 'math', tex: 'wide', display: true }], { texToSvg: huge });
    const node = fragment.nodes[0];
    expect(node.scale).toBeLessThan(1);
    expect(node.drawWidthPt).toBeLessThanOrEqual(CONTENT_WIDTH);
    expect(node.drawHeightPt).toBeCloseTo(100 * node.scale, 6);
  });

  it('reserves a placeholder box and caption for an unresolvable asset', () => {
    const [fragment] = measure([{ type: 'asset', ref: 'school/math/strips', alt: 'Fraction strips.' }]);
    expect(fragment.atomic).toBe(true);
    expect(fragment.nodes[0].kind).toBe('asset');
    expect(fragment.nodes[0].resolved).toBe(false);
    expect(fragment.heightPt).toBeGreaterThan(theme.asset.placeholderHeightPt);
  });

  it('measures a resolved SVG asset at its resolved size, capped to the content width', () => {
    const resolveAsset = () => ({ svg: '<svg viewBox="0 0 100 50"/>', widthPt: 1000, heightPt: 500 });
    const [fragment] = measure([{ type: 'asset', ref: 'r', alt: 'A.' }], { resolveAsset });
    const node = fragment.nodes[0];
    expect(node.resolved).toBe(true);
    expect(node.drawWidthPt).toBeCloseTo(CONTENT_WIDTH, 6);
    expect(node.drawHeightPt).toBeCloseTo(CONTENT_WIDTH / 2, 6);
  });

  it('measures media_action and scan_action as fixed-height labelled boxes', () => {
    const fragments = measure([
      { type: 'media_action', action: 'play:audio', label: 'Play the word problems' },
      { type: 'scan_action', action: 'scan-worksheet', label: 'Scan this page' },
    ]);
    expect(fragments.map((f) => f.nodes[0].kind)).toEqual(['action', 'action']);
    expect(fragments.map((f) => f.spacingClass)).toEqual(['action', 'action']);
    expect(fragments[0].heightPt).toBe(theme.action.heightPt);
  });
});

describe('measureBlocks — contract', () => {
  it('rejects block types with no letter renderer rather than printing a blank', () => {
    expect(() => measure([{ type: 'plot', spec: { kind: 'line' } }])).toThrow(UnsupportedBlockError);
  });

  it('ids fragments by their dotted document path', () => {
    const fragments = measure([
      { type: 'rich_text', md: 'First.\n\nSecond.' },
      { type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'rich_text', md: 'Hi.' }] },
    ]);
    expect(fragments.map((f) => f.id)).toEqual(['blocks[0]#p0', 'blocks[0]#p1', 'blocks[1]']);
  });

  it('is deterministic: the same blocks measure identically twice', () => {
    const blocks = [
      { type: 'rich_text', md: '## Head\n\nBody text that wraps a little bit here.' },
      { type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'answer_space', minPt: 40, maxPt: 80 }] },
    ];
    expect(measure(blocks)).toEqual(measure(blocks));
  });
});

describe('measureDocumentFragments', () => {
  const document = {
    id: 'doc-1',
    title: 'Doc One',
    seed: 1,
    variant: 0,
    target: ['letter'],
    blocks: [{ type: 'rich_text', md: 'Body.' }],
  };

  it('prepends a header fragment carrying the title and the name/date fields', () => {
    const doc = createMeasurementDocument({ theme });
    const fragments = measureDocumentFragments(document, {
      doc, theme, texToSvg: stubTexToSvg, studentName: 'learner-two',
    });
    expect(fragments[0].nodes[0].kind).toBe('header');
    expect(fragments[0].nodes[0].title).toBe('Doc One');
    expect(fragments[0].nodes[0].studentName).toBe('learner-two');
    expect(fragments[0].atomic).toBe(true);
  });

  it('falls back to the document id when the normalized document has no title', () => {
    const doc = createMeasurementDocument({ theme });
    const { title } = document;
    expect(title).toBeTruthy();
    const untitled = { ...document, title: undefined };
    const fragments = measureDocumentFragments(untitled, { doc, theme, texToSvg: stubTexToSvg });
    expect(fragments[0].nodes[0].title).toBe('doc-1');
  });
});

describe('probeDocument', () => {
  const wrap = (blocks) => ({ id: 'probe', seed: 1, variant: 0, target: ['letter'], blocks });

  it('reports no errors for a document that lays out', async () => {
    const result = await probeDocument(wrap([
      { type: 'rich_text', md: '## Title\n\nSome instructions for the learner.' },
      {
        type: 'question',
        itemId: 'q1',
        number: 1,
        blocks: [
          { type: 'math', tex: '\\frac{2}{3} + \\frac{1}{4}', display: true },
          { type: 'answer_space', minPt: 54, maxPt: 90 },
        ],
      },
    ]));
    expect(result.errors).toEqual([]);
  });

  it('surfaces a layout error when an atomic question cannot fit a page', async () => {
    const result = await probeDocument(wrap([{
      type: 'question',
      itemId: 'huge',
      number: 1,
      blocks: [{ type: 'answer_space', minPt: 5000, maxPt: 6000 }],
    }]));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('exceeds page height');
  });

  it('surfaces bad TeX as a document error instead of printing it', async () => {
    const result = await probeDocument(wrap([{ type: 'math', tex: '\\frac{', display: true }]));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toMatch(/blocks\[0\]/);
  });

  it('surfaces an unsupported block type as a document error', async () => {
    const result = await probeDocument(wrap([{ type: 'geometry', spec: { kind: 'triangle' } }]));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toMatch(/geometry/);
  });

  it('produces no PDF bytes — it is a measure-only gate', async () => {
    const result = await probeDocument(wrap([{ type: 'rich_text', md: 'Hello.' }]));
    expect(result.pdf).toBeUndefined();
    expect(Object.keys(result)).toEqual(['errors']);
  });
});
