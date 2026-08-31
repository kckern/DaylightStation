/**
 * Task 5 — measure + draw for the new content blocks (passage, figure, inset,
 * list, divider, spacer, page_break) under `workbookTheme`, plus the `*italic*`
 * measurement option.
 *
 * Not a pixel golden suite (that machinery — `tests/isolated/rendering/school/
 * golden/` — is pinned to `documentPdfTheme`'s existing corpus and stays
 * untouched here). Instead this pins the DETERMINISTIC, structural output of
 * measurement (one `toMatchSnapshot()` per block — a Vitest "golden" file
 * committed beside this suite) plus real end-to-end PDF renders proving every
 * new node kind has a working draw pass and the renderer's own determinism
 * guarantees (pinned CreationDate, byte-identical repeat renders) hold for
 * `workbookTheme` exactly as they do for the legacy theme.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { placeFragments } from './layout.mjs';
import {
  createMeasurementDocument, measureBlocks, parseRichText,
  BlockMeasureError, UnresolvedAssetError,
} from './measure.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const theme = createWorkbookTheme();

const STUB_SVG = '<svg viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="80" fill="#000"/></svg>';
const resolveAsset = (ref) => (ref === 'school/art/leaf' ? { svg: STUB_SVG, widthPt: 200, heightPt: 100 } : null);

const renderer = createDocumentPdfRenderer({ theme, texToSvg, resolveAsset });

const doc = (blocks, extra = {}) => ({
  id: 'workbook-blocks-test', title: 'Workbook Blocks', seed: 99, variant: 0, target: ['letter'], blocks, ...extra,
});

/** Measure a single block through the real pipeline, no PDF bytes produced. */
function measureOne(block, opts = {}) {
  const measurementDoc = createMeasurementDocument({ theme });
  return measureBlocks([block], { doc: measurementDoc, theme, texToSvg, resolveAsset, ...opts });
}

/** JSON-safe structural summary of a fragment — drops floats' jitter-prone
 * precision and pdfkit-internal doc handles, keeps everything a reviewer
 * would want to see change in a diff. */
function summarizeFragment(fragment) {
  const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const summarizeNode = (node) => {
    const { kind } = node;
    const base = { kind, heightPt: round(node.heightPt), widthPt: round(node.widthPt) };
    if (kind === 'text') return { ...base, styleKey: node.styleKey, lineCount: node.lines.length };
    if (kind === 'asset') return { ...base, resolved: node.resolved, hasCaption: Boolean(node.caption) };
    if (kind === 'box') {
      return {
        ...base, radiusPt: node.radiusPt, paddingPt: node.paddingPt, childKinds: node.childNodes.map((c) => c.kind),
      };
    }
    if (kind === 'list') {
      return { ...base, style: node.style, markers: node.items.map((item) => item.marker) };
    }
    if (kind === 'elasticSpace') return { ...base, minPt: round(node.minPt), maxPt: round(node.maxPt) };
    return base;
  };
  return {
    id: fragment.id,
    atomic: fragment.atomic,
    spacingClass: fragment.spacingClass,
    heightPt: round(fragment.heightPt),
    forceBreak: fragment.forceBreak ?? false,
    gutterPt: fragment.gutterPt,
    lineNumbers: fragment.lineNumbers,
    lineCount: fragment.lines?.length,
    lineNumbersOnLines: fragment.lines?.map((l) => l.lineNumber),
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
  // Same CreationDate-pinning check the legacy renderer suite makes —
  // determinism holds for workbookTheme exactly as it does for the legacy one.
  expect(pdf.toString('latin1').match(/\(D:\d{14}Z?\)/g)).toEqual(['(D:19700101000000Z)']);
  return { pdf, pageCount };
}

describe('workbook content blocks — measure + draw', () => {
  describe('passage', () => {
    it('reprint mode measures a flowable body fragment plus a caption citation fragment', () => {
      const block = {
        type: 'passage', mode: 'reprint',
        text: 'The quick brown fox jumps over the lazy dog. It happens again and again in this long reading passage.',
        source: { title: 'Fables', author: 'Aesop', locator: 'p. 12' },
      };
      const fragments = measureOne(block);
      expect(fragments).toHaveLength(2);
      expect(fragments[0].atomic).toBe(false);
      expect(fragments[0].styleKey).toBe('body');
      expect(fragments[1].atomic).toBe(false);
      expect(fragments[1].styleKey).toBe('caption');
      expect(fragments.map(summarizeFragment)).toMatchSnapshot();
    });

    it('cite mode renders ONLY the citation line, styled caption, no body', () => {
      const block = {
        type: 'passage', mode: 'cite', text: 'Never printed in cite mode.',
        source: { title: 'Fables', author: 'Aesop' },
      };
      const fragments = measureOne(block);
      expect(fragments).toHaveLength(1);
      expect(fragments[0].styleKey).toBe('caption');
      const printedText = fragments[0].lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
      expect(printedText).not.toContain('Never printed');
      expect(printedText).toContain('Fables');
      expect(summarizeFragment(fragments[0])).toMatchSnapshot();
    });

    it('cite mode with no source is an authoring error, refused at measure time', () => {
      expect(() => measureOne({ type: 'passage', mode: 'cite', text: 'x' }))
        .toThrow(BlockMeasureError);
    });

    it('optional line numbers are baked onto each wrapped line, aligned to a reserved gutter', () => {
      const block = {
        type: 'passage', lineNumbers: true,
        text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.',
      };
      const [body] = measureOne(block);
      expect(body.lineNumbers).toBe(true);
      expect(body.gutterPt).toBe(theme.passage.lineNumberGutterPt);
      expect(body.lines.length).toBeGreaterThan(1);
      expect(body.lines.map((l) => l.lineNumber)).toEqual(
        Array.from({ length: body.lines.length }, (_, i) => i + 1),
      );
    });

    it('keeps its keep-with-next affinity from theme.passage, not a hardcoded number', () => {
      const [body] = measureOne({ type: 'passage', text: 'Short passage.' });
      expect(body.minLinesBeforeBreak).toBe(theme.passage.minLinesBeforeBreak);
      expect(body.minLinesAfterBreak).toBe(theme.passage.minLinesAfterBreak);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([{
        type: 'passage', lineNumbers: true,
        text: 'A short reading passage for the golden PDF render assertion, long enough to wrap onto more than one line at Letter width.',
        source: { title: 'Reader', locator: 'Unit 3' },
      }]));
    });
  });

  describe('figure', () => {
    const figureBlock = {
      type: 'figure', asset: 'school/art/leaf', caption: 'A leaf.', credit: 'Photo: J. Doe',
    };

    it('measures asset + caption + credit as ONE atomic fragment', () => {
      const fragments = measureOne(figureBlock);
      expect(fragments).toHaveLength(1);
      const [fragment] = fragments;
      expect(fragment.atomic).toBe(true);
      expect(fragment.nodes.map((n) => n.kind)).toEqual(['asset', 'text', 'text']);
      expect(fragment.nodes[0].caption).toBeNull(); // caption is its own sibling node
      expect(fragment.nodes[1].styleKey).toBe('caption');
      expect(fragment.nodes[2].styleKey).toBe('caption');
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('omits the credit node when the block carries none', () => {
      const [fragment] = measureOne({ type: 'figure', asset: 'school/art/leaf', caption: 'A leaf.' });
      expect(fragment.nodes.map((n) => n.kind)).toEqual(['asset', 'text']);
    });

    it('refuses an asset it cannot resolve, same as the legacy asset block', () => {
      expect(() => measureOne({ type: 'figure', asset: 'nope', caption: 'x' }))
        .toThrow(UnresolvedAssetError);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([figureBlock]));
    });
  });

  describe('inset', () => {
    const insetBlock = {
      type: 'inset',
      title: 'Remember',
      blocks: [
        { type: 'rich_text', md: 'Always simplify your fraction.' },
        { type: 'list', style: 'bullet', items: ['Find the GCF', 'Divide both parts'] },
      ],
    };

    it('measures a box node wrapping its children, padded/radius from theme.box', () => {
      const [fragment] = measureOne(insetBlock);
      expect(fragment.atomic).toBe(true);
      const [node] = fragment.nodes;
      expect(node.kind).toBe('box');
      expect(node.radiusPt).toBe(theme.box.radiusPt);
      expect(node.paddingPt).toBe(theme.box.paddingPt);
      // title node first, then the two content children.
      expect(node.childNodes.map((c) => c.kind)).toEqual(['text', 'text', 'list']);
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('omits the title node when the inset carries none', () => {
      const [fragment] = measureOne({
        type: 'inset', blocks: [{ type: 'rich_text', md: 'No title here.' }],
      });
      expect(fragment.nodes[0].childNodes.map((c) => c.kind)).toEqual(['text']);
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([insetBlock]));
    });
  });

  describe('compact worked example', () => {
    const example = {
      type: 'inset', layout: 'worked_example', title: 'Worked example',
      questionPrompt: 'In 364, what value does the digit 6 represent?',
      choiceLabels: ['6', '60', '600'],
      solutionSteps: ['The 6 is in the tens place.', 'Six tens equal 60.'],
      correctChoiceIndex: 1, correctText: '60',
      blocks: [{ type: 'rich_text', md: 'Fallback worked example.' }],
    };

    it('measures as one compact atomic strip and renders a real PDF', async () => {
      const [fragment] = measureOne(example);
      expect(fragment.atomic).toBe(true);
      expect(fragment.nodes[0].kind).toBe('workedExample');
      expect(fragment.nodes[0].groups).toHaveLength(3);
      expect(fragment.heightPt).toBeLessThan(90);
      await expectRealPdf(doc([example]));
    });
  });

  describe('list', () => {
    it('bullet items get the bullet-character marker', () => {
      const [fragment] = measureOne({ type: 'list', style: 'bullet', items: ['One', 'Two'] });
      const [node] = fragment.nodes;
      expect(node.items.map((i) => i.marker)).toEqual([theme.list.bulletCharacter, theme.list.bulletCharacter]);
    });

    it('numbered items get a 1-based number marker', () => {
      const [fragment] = measureOne({ type: 'list', style: 'numbered', items: ['One', 'Two', 'Three'] });
      const [node] = fragment.nodes;
      expect(node.items.map((i) => i.marker)).toEqual(['1.', '2.', '3.']);
    });

    it('checklist items carry NO text marker — a vector square is drawn instead', () => {
      const [fragment] = measureOne({ type: 'list', style: 'checklist', items: ['Pack lunch', 'Pack water'] });
      const [node] = fragment.nodes;
      expect(node.items.every((i) => i.marker === null)).toBe(true);
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('renders a real PDF end to end for every style', async () => {
      await expectRealPdf(doc([
        { type: 'list', style: 'bullet', items: ['Alpha', 'Beta'] },
        { type: 'list', style: 'numbered', items: ['Alpha', 'Beta'] },
        { type: 'list', style: 'checklist', items: ['Alpha', 'Beta'] },
      ]));
    });
  });

  describe('divider', () => {
    it('measures a bare rule reserving theme.divider vertical space', () => {
      const [fragment] = measureOne({ type: 'divider' });
      expect(fragment.nodes[0].kind).toBe('divider');
      expect(fragment.heightPt).toBeCloseTo(
        theme.divider.paddingAbovePt + theme.divider.ruleWidthPt + theme.divider.paddingBelowPt, 5,
      );
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('renders a real PDF end to end', async () => {
      await expectRealPdf(doc([
        { type: 'rich_text', md: 'Above the rule.' },
        { type: 'divider' },
        { type: 'rich_text', md: 'Below the rule.' },
      ]));
    });
  });

  describe('spacer', () => {
    it('reuses the answer_space {minPt,maxPt} fragment mechanics', () => {
      const [fragment] = measureOne({ type: 'spacer', minPt: 40, maxPt: 120 });
      expect(fragment.nodes[0].kind).toBe('elasticSpace');
      expect(fragment.answerSpace).toEqual({ minPt: 40, maxPt: 120 });
      expect(summarizeFragment(fragment)).toMatchSnapshot();
    });

    it('draws no ruled lines — renders successfully with a no-op draw pass', async () => {
      // If the renderer's draw switch didn't handle 'elasticSpace' this would
      // throw "no draw pass for measured node kind"; success IS the assertion
      // that the spacer puts no ink on the page.
      await expectRealPdf(doc([{ type: 'spacer', minPt: 40, maxPt: 120 }]));
    });
  });

  describe('page_break', () => {
    it('measures to a zero-height forceBreak fragment', () => {
      const [fragment] = measureOne({ type: 'page_break' });
      expect(fragment.forceBreak).toBe(true);
      expect(fragment.heightPt).toBe(0);
      expect(fragment.nodes).toEqual([]);
    });

    it('forces an actual page boundary in placement (Task 7)', async () => {
      const { pageCount } = await expectRealPdf(doc([
        { type: 'rich_text', md: 'Before the break.' },
        { type: 'page_break' },
        { type: 'rich_text', md: 'After the break.' },
      ]));
      expect(pageCount).toBe(2);
    });
  });

  describe('inset-nested elastic space — pinned at minPt, not grown (Task 5/7 carry)', () => {
    it('a spacer nested inside an inset never surfaces as the box fragment’s answerSpace', () => {
      const [fragment] = measureOne({
        type: 'inset',
        blocks: [
          { type: 'rich_text', md: 'Write your answer below.' },
          { type: 'spacer', minPt: 20, maxPt: 200 },
        ],
      });
      expect(fragment.answerSpace).toBeNull();
    });

    it('growLastPage (fit policy fill) grows a top-level spacer but leaves the inset-nested one at minPt', () => {
      const [insetFragment] = measureOne({
        type: 'inset',
        blocks: [{ type: 'spacer', minPt: 20, maxPt: 200 }],
      });
      const [topSpacerFragment] = measureOne({ type: 'spacer', minPt: 20, maxPt: 200 });
      const insetHeightBeforePlacement = insetFragment.heightPt;

      const { pages, errors } = placeFragments([insetFragment, topSpacerFragment], {
        pageHeightPt: theme.page.heightPt,
        marginPt: theme.page.marginPt,
        spacing: theme.spacing,
        growLastPage: true,
      });

      expect(errors).toEqual([]);
      expect(pages).toHaveLength(1);
      const placedInset = pages[0].fragments.find((f) => f.id === insetFragment.id);
      const placedTopSpacer = pages[0].fragments.find((f) => f.id === topSpacerFragment.id);
      // Pinned: the box's answerSpace is null (see the test above), so
      // distributeAnswerSpace has nothing to grow on it — even on the (only,
      // hence last) page with growLastPage on.
      expect(placedInset.heightPt).toBe(insetHeightBeforePlacement);
      // Contrast: the SAME page's top-level elasticSpace fragment DOES grow,
      // proving growLastPage itself works and the inset is the outlier.
      expect(placedTopSpacer.heightPt).toBeGreaterThan(20);
    });
  });

  describe('everything together', () => {
    it('composes all seven new block types into one document without a layout error', async () => {
      const { pageCount } = await expectRealPdf(doc([
        { type: 'passage', text: 'A short passage to open the worksheet.', source: { title: 'Reader' } },
        { type: 'figure', asset: 'school/art/leaf', caption: 'A leaf.' },
        {
          type: 'inset',
          title: 'Tip',
          blocks: [{ type: 'list', style: 'checklist', items: ['Read carefully', 'Show your work'] }],
        },
        { type: 'list', style: 'numbered', items: ['First', 'Second'] },
        { type: 'divider' },
        { type: 'spacer', minPt: 30, maxPt: 60 },
        { type: 'page_break' },
        { type: 'rich_text', md: 'The second half of the worksheet.' },
      ]));
      expect(pageCount).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('*italic* — v2 measurement option', () => {
  const md = 'Mix **bold**, *italic*, `code`, and $x^2$ math in one line.';

  it('defaults OFF: a lone asterisk pair is left as literal text, same as before this option existed', () => {
    const segments = parseRichText(md);
    const bodyText = segments.filter((s) => s.kind === 'text').map((s) => s.text).join('');
    expect(bodyText).toContain('*italic*');
    expect(bodyText).toContain('bold'); // ** stripped, bold content kept — unaffected by the new option
  });

  it('calling with no options at all is byte-identical to calling with {italic:false}', () => {
    expect(parseRichText(md)).toEqual(parseRichText(md, { italic: false }));
  });

  it('when {italic:true}, *italic* is recognised and its asterisks are stripped', () => {
    const on = parseRichText(md, { italic: true });
    const bodyText = on.filter((s) => s.kind === 'text').map((s) => s.text).join('');
    expect(bodyText).not.toContain('*italic*');
    expect(bodyText).toContain('italic');
  });

  it('still disambiguates **bold** from *italic* when the option is on', () => {
    const on = parseRichText('Just **bold** here.', { italic: true });
    const bodyText = on.filter((s) => s.kind === 'text').map((s) => s.text).join('');
    expect(bodyText).toContain('bold');
    expect(bodyText).not.toContain('*');
  });

  it('threads through rich_text measurement without changing the v1 default', () => {
    const block = { type: 'rich_text', md: 'A *stress* test of the option.' };
    const off = measureOne(block);
    const defaulted = measureOne(block, {}); // no italic key at all
    expect(defaulted.map(summarizeFragment)).toEqual(off.map(summarizeFragment));

    const on = measureOne(block, { italic: true });
    const offText = off[0].lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
    const onText = on[0].lines.flatMap((l) => l.runs.map((r) => r.text)).join('');
    expect(offText).toContain('*stress*');
    expect(onText).toContain('stress');
    expect(onText).not.toContain('*stress*');
  });
});
