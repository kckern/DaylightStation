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
  it('logs a warn with the count and a truncated id sample of draft units dropped', async () => {
    const { logged, curriculum } = harness([
      unit('approved-1', 'approved'),
      unit('draft-1', 'draft'),
      unit('draft-2', 'draft'),
    ]);

    const units = await curriculum.listUnits();
    expect(units.map((u) => u.unitId)).toEqual(['approved-1']);

    const draftLogs = logged.filter((l) => l.event === 'school.curriculum.drafts-dropped');
    expect(draftLogs).toHaveLength(1);
    expect(draftLogs[0].data).toEqual({ count: 2, sampleIds: ['draft-1', 'draft-2'] });
  });

  it('does not log drafts-dropped when every unit is approved', async () => {
    const { logged, curriculum } = harness([unit('approved-1', 'approved')]);
    await curriculum.listUnits();
    expect(logged.filter((l) => l.event === 'school.curriculum.drafts-dropped')).toHaveLength(0);
  });

  it('carries the full count and a truncated (first ~10) id sample, never the whole array', async () => {
    const draftIds = Array.from({ length: 175 }, (_, i) => `draft-${i}`);
    const { logged, curriculum } = harness([
      unit('approved-1', 'approved'),
      ...draftIds.map((id) => unit(id, 'draft')),
    ]);

    await curriculum.listUnits();

    const draftLogs = logged.filter((l) => l.event === 'school.curriculum.drafts-dropped');
    expect(draftLogs).toHaveLength(1);
    expect(draftLogs[0].data.count).toBe(175);
    expect(draftLogs[0].data.sampleIds).toHaveLength(10);
    expect(draftLogs[0].data.sampleIds).toEqual(draftIds.slice(0, 10));
  });

  it('logs exactly ONE line across two consecutive loads when the dropped set is unchanged', async () => {
    const { logged, curriculum } = harness([
      unit('approved-1', 'approved'),
      unit('draft-1', 'draft'),
      unit('draft-2', 'draft'),
    ]);

    await curriculum.listUnits();
    curriculum.invalidate();
    await curriculum.listUnits();

    expect(logged.filter((l) => l.event === 'school.curriculum.drafts-dropped')).toHaveLength(1);
  });

  it('logs a new line immediately when the dropped set grows', async () => {
    const units = [
      unit('approved-1', 'approved'),
      unit('draft-1', 'draft'),
      unit('draft-2', 'draft'),
    ];
    const { logged, curriculum } = harness(units);

    await curriculum.listUnits();
    expect(logged.filter((l) => l.event === 'school.curriculum.drafts-dropped')).toHaveLength(1);

    units.push(unit('draft-3', 'draft'));
    curriculum.invalidate();
    await curriculum.listUnits();

    const draftLogs = logged.filter((l) => l.event === 'school.curriculum.drafts-dropped');
    expect(draftLogs).toHaveLength(2);
    expect(draftLogs[1].data.count).toBe(3);
  });
});
