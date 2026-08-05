/**
 * F1 (final fix-wave finding) — the v2 block×target compatibility matrix
 * (`BLOCK_TARGET_SUPPORT`, `documentV2.mjs`) approved five block types
 * (`scan_action`, `media_action`, `math`, `asset`, `omr_response`) for
 * `letter` that `createWorkbookTheme()` could not actually measure/draw:
 * `theme.action` (scan_action/media_action — this also broke the envelope
 * `source` sugar, which desugars to a `scan_action`), `theme.math`,
 * `styles.instruction` (asset alt/caption — measure.mjs's measureAssetNode),
 * `theme.omr` (omr_response inside a question). workbookTheme.mjs now
 * carries all four groups (plus the `instruction` style).
 *
 * This suite is the matrix's own contract test: EVERY entry in
 * `BLOCK_TARGET_SUPPORT` gets a minimal valid v2 document and must either
 * (a) render a real PDF under `createWorkbookTheme()` without throwing, or
 * (b) for entries with no Letter renderer AT ALL yet (`plot`, `geometry` —
 * a renderer-registry gap documented directly in `measure.mjs`'s
 * `measureNodes` default case, unrelated to theme token completeness),
 * throw the SAME `UnsupportedBlockError` they throw under every theme, so
 * that gap stays visible rather than silently masked by a matrix that
 * claims support no renderer provides.
 *
 * Print Design Phase B, Task 2 (assessment blocks — domain layer) added
 * `wordbank`/`matching`/`cloze`/`short_answer`/`essay` to
 * `BLOCK_TARGET_SUPPORT`, landing them in bucket (b) (domain-only validation,
 * no `measure.mjs` case yet). Phase B Task 4 ("Assessment rendering") moved
 * all five into bucket (a): `measure.mjs`/`DocumentPdfRenderer.mjs` now carry
 * a real case for each, so only `plot`/`geometry` remain in bucket (b).
 */
import { describe, it, expect } from 'vitest';
import { validateDocumentV2, BLOCK_TARGET_SUPPORT, DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { UnsupportedBlockError } from './measure.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { texToSvg } from './mathSvg.mjs';

const STUB_SVG = '<svg viewBox="0 0 200 100"><rect width="200" height="80" fill="#000"/></svg>';
const resolveAsset = (ref) => (ref === 'school/proof/art' ? { svg: STUB_SVG, widthPt: 200, heightPt: 100 } : null);
const bank = { id: 'matrix-bank', items: [{ id: 'omr-item', choices: ['A', 'B', 'C', 'D'] }] };

const theme = createWorkbookTheme();
const renderer = createDocumentPdfRenderer({ theme, texToSvg, resolveAsset });

/**
 * One minimal, valid block per `BLOCK_TARGET_SUPPORT` key. `omr_response`
 * is nested inside a `question` — the only structurally legal position
 * (`documentValidation.mjs`'s walk rule) and exactly the composition F1
 * calls out ("omr_response inside a question").
 */
const FIXTURE_BLOCK = {
  rich_text: { type: 'rich_text', md: 'Plain body text.' },
  scan_action: { type: 'scan_action', action: 'watch-review', label: 'Watch the review video' },
  media_action: { type: 'media_action', action: 'play-clip', label: 'Play the clip' },
  math: { type: 'math', tex: 'x^2 + 1' },
  plot: { type: 'plot', spec: { kind: 'line' } },
  geometry: { type: 'geometry', spec: { kind: 'triangle' } },
  asset: { type: 'asset', ref: 'school/proof/art', alt: 'A proof-suite diagram.' },
  question: {
    type: 'question', itemId: 'matrix-q', number: 1, blocks: [{ type: 'rich_text', md: 'Solve for x.' }],
  },
  answer_space: { type: 'answer_space', minPt: 20, maxPt: 40 },
  omr_response: {
    type: 'question',
    itemId: 'omr-item',
    number: 1,
    blocks: [{ type: 'omr_response', itemId: 'omr-item', choices: 4 }],
  },
  passage: { type: 'passage', text: 'A short reading passage for the matrix fixture.' },
  figure: { type: 'figure', asset: 'school/proof/art', caption: 'A diagram.' },
  inset: { type: 'inset', blocks: [{ type: 'rich_text', md: 'A tip inside the box.' }] },
  list: { type: 'list', style: 'bullet', items: ['One', 'Two'] },
  divider: { type: 'divider' },
  spacer: { type: 'spacer', minPt: 10, maxPt: 20 },
  page_break: { type: 'page_break' },
  // Phase B Task 2 (domain-only): valid blocks with no measure.mjs case yet.
  wordbank: { type: 'wordbank', key: 'wb1', terms: ['Alpha', 'Beta'] },
  matching: {
    type: 'matching', key: 'm1', left: ['A', 'B'], right: ['1', '2'],
  },
  cloze: { type: 'cloze', text: 'The {{1}} is red.', blanks: [{ n: 1 }] },
  short_answer: { type: 'short_answer', prompt: 'Name a color.' },
  essay: { type: 'essay', prompt: 'Describe the color.' },
};

/** No Letter renderer exists at all (any theme) — see measure.mjs's own comment. */
const NO_RENDERER_YET = new Set(['plot', 'geometry']);

describe('BLOCK_TARGET_SUPPORT matrix — every entry validates and renders under createWorkbookTheme() (F1)', () => {
  const types = Object.keys(BLOCK_TARGET_SUPPORT);

  it('the fixture map covers every matrix entry (guards a silently un-exercised new block type)', () => {
    expect(new Set(Object.keys(FIXTURE_BLOCK))).toEqual(new Set(types));
  });

  for (const type of types) {
    const expectation = NO_RENDERER_YET.has(type)
      ? 'is refused with UnsupportedBlockError (no Letter renderer yet — not a theme gap)'
      : 'renders a real PDF under createWorkbookTheme()';

    it(`'${type}': validates under v2 and ${expectation}`, async () => {
      const raw = {
        schema: DOCUMENT_V2_SCHEMA,
        id: `matrix-${type.replace(/_/g, '-')}`,
        seed: 1,
        target: ['letter'],
        archetype: 'worksheet',
        blocks: [FIXTURE_BLOCK[type]],
      };
      const { errors, document } = validateDocumentV2(raw);
      expect(errors, `validation errors for '${type}': ${errors.join('; ')}`).toEqual([]);

      const renderOptions = type === 'omr_response' ? { bank } : {};
      if (NO_RENDERER_YET.has(type)) {
        await expect(renderer.render(document, renderOptions)).rejects.toThrow(UnsupportedBlockError);
      } else {
        const { pdf, pageCount } = await renderer.render(document, renderOptions);
        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(pageCount).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

describe('envelope `source` sugar renders end to end under createWorkbookTheme() (F1)', () => {
  it('desugars to a scan_action block (theme.action) and renders without throwing', async () => {
    const raw = {
      schema: DOCUMENT_V2_SCHEMA,
      id: 'matrix-source-sugar',
      seed: 1,
      target: ['letter'],
      archetype: 'worksheet',
      source: { action: 'watch-review', label: 'Watch the review video' },
      blocks: [{ type: 'rich_text', md: 'Body text after the sugared header action.' }],
    };
    const { errors, document } = validateDocumentV2(raw);
    expect(errors).toEqual([]);
    expect(document.blocks[0]).toMatchObject({ type: 'scan_action', action: 'watch-review' });

    const { pdf, pageCount } = await renderer.render(document);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBeGreaterThanOrEqual(1);
  });
});
