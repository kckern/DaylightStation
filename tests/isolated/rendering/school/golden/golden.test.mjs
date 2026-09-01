/**
 * Golden page suite — the printed page IS the contract.
 *
 * See goldenHarness.mjs for what is compared and how to regenerate snapshots
 * (UPDATE_GOLDEN=1). This suite never skips: a missing `pdftoppm` fails loudly,
 * and a missing snapshot fails rather than silently creating one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  GOLDEN_CASES,
  UPDATE_GOLDEN,
  MARK_MAX_DIFF_RATIO,
  MAX_DIFF_RATIO,
  renderCase,
  rasterizePages,
  comparePage,
  compareFormMap,
  markRegionsFor,
  requirePdftoppm,
} from './goldenHarness.mjs';

describe('school document golden pages', () => {
  beforeAll(() => {
    // Fails the whole suite, immediately and with instructions, rather than
    // letting each case discover the missing tool on its own.
    requirePdftoppm();
  });

  for (const testCase of GOLDEN_CASES) {
    describe(testCase.name, () => {
      let rendered;
      let pages;
      let regions;

      beforeAll(async () => {
        rendered = await renderCase(testCase);
        pages = rasterizePages(rendered.pdf, testCase.name);
        regions = markRegionsFor(rendered);
      }, 60000);

      it('rasterizes exactly the pages the renderer reported', () => {
        expect(pages.length).toBe(rendered.pageCount);
        expect(pages.length).toBeGreaterThanOrEqual(testCase.minimumPages ?? 1);
      });

      it('matches its committed page snapshots', async () => {
        const failures = [];
        for (let index = 0; index < pages.length; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          const result = await comparePage(testCase.name, index + 1, pages[index], {
            regions, maxDiffRatio: testCase.maxDiffRatio,
          });
          if (!result.ok) failures.push(`page ${index + 1}: ${result.reason}`);
        }
        expect(failures).toEqual([]);
      }, 60000);

      it('holds every machine-read box to the tighter budget', () => {
        // A case that stopped producing regions would silently drop back to the
        // page budget, which is the loophole this tier exists to close.
        const expectedRegions = (rendered.formMap?.marks?.length ?? 0) > 0 || rendered.codeMap.length > 0;
        expect(regions.length > 0).toBe(expectedRegions);
        for (const region of regions) {
          expect(region.widthPt, `${region.name} has no width`).toBeGreaterThan(0);
          expect(region.heightPt, `${region.name} has no height`).toBeGreaterThan(0);
        }
      });

      it('renders byte-identically on a second run', async () => {
        const again = await renderCase(testCase);
        expect(again.pdf.equals(rendered.pdf)).toBe(true);
      }, 60000);

      if (testCase.formMapSnapshot) {
        it('pins every bubble coordinate exactly — no tolerance', () => {
          const expected = compareFormMap(testCase.formMapSnapshot, rendered.formMap);
          expect(rendered.formMap).toEqual(expected);
          // Guard against a snapshot that was regenerated into emptiness.
          expect(rendered.formMap.marks.length).toBeGreaterThan(0);
        });
      }
    });
  }

  it('keeps machine-read marks on a tighter budget than prose', () => {
    // Stated as an assertion so the two numbers cannot be quietly collapsed
    // back into one: the whole point is that a code box and a paragraph do not
    // get the same slack.
    expect(MARK_MAX_DIFF_RATIO).toBeLessThan(MAX_DIFF_RATIO);
    expect(MARK_MAX_DIFF_RATIO).toBeGreaterThan(0);
  });

  it('covers the OMR fixture with bubble-row and code boxes', async () => {
    const omrCase = GOLDEN_CASES.find((c) => c.formMapSnapshot);
    const omr = await renderCase(omrCase);
    const regions = markRegionsFor(omr);
    // Six questions, four bubbles each, printed as six rows; one scan_action.
    expect(regions.filter((r) => r.name.startsWith('bubble-row'))).toHaveLength(6);
    expect(regions.filter((r) => r.name.startsWith('code-box'))).toHaveLength(1);
    expect(new Set(regions.map((r) => r.page))).toEqual(new Set([1, 2]));
  }, 60000);

  it('is not running in snapshot-update mode in CI', () => {
    // A run that regenerates snapshots asserts nothing about them; surfacing it
    // here keeps an UPDATE_GOLDEN=1 run from being mistaken for a green one.
    expect(UPDATE_GOLDEN, 'UPDATE_GOLDEN=1 regenerates snapshots and verifies nothing').toBe(false);
  });
});
