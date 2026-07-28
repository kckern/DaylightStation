/**
 * The read the parent surfaces never had.
 *
 * The review queue could only show `math-fractions.03` because nothing served
 * the lifecycle catalog over HTTP, so a parent marking a sheet was told the id
 * of the unit and nothing about what it teaches.
 *
 * The summary is deliberately NOT the whole unit: `review.answerKey` lives on a
 * unit, and these routes are as reachable as any other on this console. A list
 * that hands out the answers to the sheet a child is holding would be a worse
 * bug than the one it fixes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { FakeCatalog, fakeClock, silentLogger } from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  WORKSHEET_UNIT, OMR_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

let curriculum;

beforeEach(() => {
  const clock = fakeClock();
  curriculum = new CurriculumAccess({
    catalog: new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() }),
    bankIds: () => BANK_IDS,
    clock: clock.epoch,
    logger: silentLogger,
  });
});

describe('unit summaries', () => {
  it('names every publishable unit and says what it teaches', async () => {
    const units = await curriculum.listUnitSummaries();
    const one = units.find((u) => u.unitId === WORKSHEET_UNIT);
    expect(one).toMatchObject({
      unitId: WORKSHEET_UNIT,
      title: fixtureUnit(WORKSHEET_UNIT).title,
      subject: 'math',
      courseId: 'math-fractions',
    });
    expect(one.objectives.length).toBeGreaterThan(0);
  });

  it('NEVER carries the answer key, or anything else off the parent rubric', async () => {
    // The fixture unit really does have one, so this is a live check.
    expect(fixtureUnit(WORKSHEET_UNIT).review.answerKey.length).toBeGreaterThan(0);

    const units = await curriculum.listUnitSummaries();
    const serialised = JSON.stringify(units);
    expect(serialised).not.toMatch(/answerKey/);
    expect(units.every((u) => !('review' in u))).toBe(true);
  });

  it('says how the unit is delivered without handing over the artefacts', async () => {
    const units = await curriculum.listUnitSummaries();
    const omr = units.find((u) => u.unitId === OMR_UNIT);
    expect(omr).toMatchObject({ hasBank: true, hasDocument: true, hasMedia: false });
    expect(omr).not.toHaveProperty('bank');
    expect(omr).not.toHaveProperty('document');
  });

  it('reads one unit by id, in the same shape', async () => {
    expect(await curriculum.getUnitSummary(OMR_UNIT)).toMatchObject({ unitId: OMR_UNIT, subject: 'math' });
  });

  it('answers null for an unknown or draft unit rather than throwing', async () => {
    expect(await curriculum.getUnitSummary('no-such-unit')).toBeNull();
  });

  it('serves only what a learner could be handed — a draft stays invisible', async () => {
    const clock = fakeClock();
    const draftOne = new CurriculumAccess({
      catalog: new FakeCatalog({
        units: rawUnits({ [OMR_UNIT]: { provenance: { source: 'test', reviewState: 'draft' } } }),
        documents: rawDocuments(),
        manifests: rawManifests(),
      }),
      bankIds: () => BANK_IDS,
      clock: clock.epoch,
      logger: silentLogger,
    });
    const ids = (await draftOne.listUnitSummaries()).map((u) => u.unitId);
    expect(ids).not.toContain(OMR_UNIT);
    expect(await draftOne.getUnitSummary(OMR_UNIT)).toBeNull();
  });
});
