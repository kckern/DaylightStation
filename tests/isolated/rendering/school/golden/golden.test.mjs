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
  renderCase,
  rasterizePages,
  comparePage,
  compareFormMap,
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

      beforeAll(async () => {
        rendered = await renderCase(testCase);
        pages = rasterizePages(rendered.pdf, testCase.name);
      }, 60000);

      it('rasterizes exactly the pages the renderer reported', () => {
        expect(pages.length).toBe(rendered.pageCount);
        expect(pages.length).toBeGreaterThan(0);
      });

      it('matches its committed page snapshots', async () => {
        const failures = [];
        for (let index = 0; index < pages.length; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          const result = await comparePage(testCase.name, index + 1, pages[index]);
          if (!result.ok) failures.push(`page ${index + 1}: ${result.reason}`);
        }
        expect(failures).toEqual([]);
      }, 60000);

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

  it('is not running in snapshot-update mode in CI', () => {
    // A run that regenerates snapshots asserts nothing about them; surfacing it
    // here keeps an UPDATE_GOLDEN=1 run from being mistaken for a green one.
    expect(UPDATE_GOLDEN, 'UPDATE_GOLDEN=1 regenerates snapshots and verifies nothing').toBe(false);
  });
});
