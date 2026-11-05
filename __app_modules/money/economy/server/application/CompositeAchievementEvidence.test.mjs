// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CompositeAchievementEvidence } from './CompositeAchievementEvidence.mjs';
import { EarningsPreviewService } from './EarningsPreviewService.mjs';
import { validateRuleset } from '../domain/earnings/index.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('CompositeAchievementEvidence', () => {
  it('merges providers per learner; a failing provider makes only its activities unavailable', async () => {
    const warned = [];
    const composite = new CompositeAchievementEvidence({
      providers: [
        { name: 'school', activities: ['card-goal'], async week() { return { learners: { a: { days: { 'card-goal': ['2026-11-02'] } }, ghost: { days: {} } } }; } },
        { name: 'piano', activities: ['board-game-level', 'piano-practice'], async week() { throw new Error('disk'); } },
        { name: 'fitness', activities: ['race'], async week() { return { learners: { b: { milestones: { 'race-pb': [{ key: 'k', day: '2026-11-03' }] } } }, contests: { race: { standings: [], closed: false } } }; } },
      ],
      logger: { ...silent, warn: (e, d) => warned.push([e, d.source]) },
    });
    const out = await composite.week({ learnerIds: ['a', 'b'] });
    expect(out.learners).toEqual({
      a: { days: { 'card-goal': ['2026-11-02'] }, milestones: {} },
      b: { days: {}, milestones: { 'race-pb': [{ key: 'k', day: '2026-11-03' }] } },
    });
    expect(out.contests).toEqual({ race: { standings: [], closed: false } });
    expect(out.unavailable).toEqual(['board-game-level', 'piano-practice']);
    expect(warned).toEqual([['economy.gems.evidence-unavailable', 'piano']]);
  });
});

describe('EarningsPreviewService with achievements', () => {
  const RULES = validateRuleset({
    revision: 1,
    rules: [
      { id: 'cards', kind: 'activity-days', match: { activity: 'card-goal' }, days: 1, reward: { gems: 1 } },
      { id: 'race', kind: 'activity-contest', match: { activity: 'race' }, reward: { gems: 1 } },
    ],
  });
  function build(achievementEvidence) {
    return new EarningsPreviewService({
      rules: { get: async () => RULES },
      schoolEvidence: { async schoolWeek() { return {}; } },
      ringEvidence: { async standings({ learnerIds }) { return learnerIds.map((learnerId) => ({ learnerId, rings: 0, sessions: [] })); } },
      achievementEvidence,
      learners: async () => [{ id: 'a' }, { id: 'b' }],
      clock: () => new Date('2026-11-04T20:00:00Z'),
      timezone: 'America/Los_Angeles',
      logger: silent,
    });
  }

  it('reads the evidence once per roster with the week windows, and prices each learner from it', async () => {
    const calls = [];
    const out = await build({
      async week(args) {
        calls.push(args);
        return {
          learners: { a: { days: { 'card-goal': ['2026-11-03'] }, milestones: {} }, b: { days: {}, milestones: {} } },
          contests: { race: { standings: [{ learnerId: 'b', score: 9 }], closed: false } },
          unavailable: [],
        };
      },
    }).roster();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ learnerIds: ['a', 'b'], week: { from: '2026-11-02', to: '2026-11-08' }, today: '2026-11-04' });
    expect(calls[0].schoolMs.toMs - calls[0].schoolMs.fromMs).toBe(7 * 86_400_000);
    expect(calls[0].studyDay(Date.parse('2026-11-04T10:00:00Z'))).toBe('2026-11-03'); // 2 am Pacific belongs to yesterday
    const a = out.learners.find((l) => l.learnerId === 'a');
    const b = out.learners.find((l) => l.learnerId === 'b');
    expect(a.lines.find((l) => l.ruleId === 'cards').status).toBe('earned');
    expect(b.lines.find((l) => l.ruleId === 'race')).toMatchObject({ status: 'pending', leader: true });
  });

  it('without a source, or when it throws, the achievement lines are indeterminate', async () => {
    for (const source of [null, { async week() { throw new Error('x'); } }]) {
      const out = await build(source).roster();
      expect(out.learners[0].lines.map((l) => l.status)).toEqual(['indeterminate', 'indeterminate']);
    }
  });

  it('shares one read a minute, but a fresh read sees a race that landed inside that minute', async () => {
    let reads = 0;
    let standings = [];
    const service = build({
      async week() {
        reads += 1;
        return { learners: { a: { days: {}, milestones: {} }, b: { days: {}, milestones: {} } }, contests: { race: { standings, closed: false } }, unavailable: [] };
      },
    });
    const raceLine = (out) => out.learners.find((l) => l.learnerId === 'a').lines.find((l) => l.ruleId === 'race');
    expect(raceLine(await service.roster()).leader).toBe(false);
    standings = [{ learnerId: 'a', score: 1116 }]; // the race lands
    expect(raceLine(await service.roster()).leader).toBe(false); // the poll's shared copy
    expect(reads).toBe(1);
    expect(raceLine(await service.roster({ fresh: true }))).toMatchObject({ status: 'pending', leader: true });
    expect(reads).toBe(2);
    expect(raceLine(await service.roster()).leader).toBe(true); // and the fresh read replaced the shared copy
    expect(reads).toBe(2);
  });
});
