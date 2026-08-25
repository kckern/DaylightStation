import { describe, expect, it } from 'vitest';
import { CurriculumAccess } from './CurriculumAccess.mjs';

/**
 * A minimal, otherwise-valid unit: subject + provenance + a `review` free-form
 * reference (so the "must reference at least one of bank/document/media/review"
 * rule is satisfied without needing bank/document/manifest sets injected).
 */
const unit = (unitId, reviewState) => ({
  unitId,
  title: `Unit ${unitId}`,
  subject: 'math',
  review: 'parent checks work',
  provenance: { source: 'Test Source', reviewState },
});

function harness(units) {
  const logged = [];
  const logger = {
    warn: (event, data) => logged.push({ event, data }),
    info: () => {},
    error: () => {},
  };
  const catalog = {
    listUnits: async () => ({ items: units.map((raw) => ({ id: raw.unitId, raw })), errors: [] }),
    listDocuments: async () => ({ items: [], errors: [] }),
    listManifests: async () => ({ items: [], errors: [] }),
  };
  return { logged, curriculum: new CurriculumAccess({ catalog, logger }) };
}

describe('CurriculumAccess — drafts dropped from the publishable set', () => {
  it('logs a warn with the count and ids of draft units dropped, same shape as invalid-units', async () => {
    const { logged, curriculum } = harness([
      unit('approved-1', 'approved'),
      unit('draft-1', 'draft'),
      unit('draft-2', 'draft'),
    ]);

    const units = await curriculum.listUnits();
    expect(units.map((u) => u.unitId)).toEqual(['approved-1']);

    const draftLogs = logged.filter((l) => l.event === 'school.curriculum.drafts-dropped');
    expect(draftLogs).toHaveLength(1);
    expect(draftLogs[0].data).toEqual({ count: 2, ids: ['draft-1', 'draft-2'] });
  });

  it('does not log drafts-dropped when every unit is approved', async () => {
    const { logged, curriculum } = harness([unit('approved-1', 'approved')]);
    await curriculum.listUnits();
    expect(logged.filter((l) => l.event === 'school.curriculum.drafts-dropped')).toHaveLength(0);
  });
});
