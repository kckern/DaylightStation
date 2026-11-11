// @vitest-environment node
/**
 * What one standings / Gem Board read costs in School's day projections — the
 * expensive source (a replayed plan, ~1 s a day with a Plex-backed piano
 * course, and Plex requests serialize). 2026-11-10: the fitness standings
 * priced the roster twice (its own, and the board's for the gem chips) and
 * concurrent reads each replayed today and yesterday again, so the garage card
 * and the Gem Board waited ~50 s under load. Real services throughout; only the
 * day projection is a counting double.
 */
import { describe, it, expect } from 'vitest';
import { TermVerdictService } from '../../../../learning/school/server/application/TermVerdictService.mjs';
import { SchoolEarningEvidence } from '../adapters/school/SchoolEarningEvidence.mjs';
import { EarningsPreviewService } from './EarningsPreviewService.mjs';
import { GemBoardService } from './GemBoardService.mjs';
import { WorkoutEarningsService } from './WorkoutEarningsService.mjs';
import { validateRuleset } from '../domain/earnings/index.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TZ = 'America/Los_Angeles';
const NOW = Date.parse('2026-11-04T20:00:00.000Z'); // Wed noon Pacific
const LEARNERS = ['a', 'b', 'c', 'd'];
const STEP_MS = 15;
const RULES = validateRuleset({
  revision: 1,
  rules: [
    { id: 'moved', label: 'Moved', kind: 'ring-days', days: 2, reward: { gems: 1 }, gem: { category: 'exercise', label: 'Exercise' } },
    { id: 'contest', label: 'Most rings', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ],
});

class MemoryCache {
  docs = new Map();
  async read(l, t) { const d = this.docs.get(`${l}/${t}`); return d ? structuredClone(d) : null; }
  async write(l, t, doc) { this.docs.set(`${l}/${t}`, structuredClone(doc)); }
}

async function build() {
  let offset = 0;
  const clock = () => new Date(NOW + offset);
  // One projection at a time, STEP_MS each: the serialized source.
  let chain = Promise.resolve();
  const projections = [];
  const completion = {
    execute({ learnerId, studyDay = null }) {
      projections.push(`${learnerId}|${studyDay ?? 'today'}`);
      const run = chain.then(() => new Promise((r) => setTimeout(r, STEP_MS)));
      chain = run;
      return run.then(() => ({ learnerId, studyDate: studyDay, state: 'complete', excused: [], faults: [], sections: [{ subject: 'math', state: 'served', reason: null }] }));
    },
  };
  const termVerdicts = new TermVerdictService({
    getLearnerDayCompletion: completion, cache: new MemoryCache(),
    academicPeriods: { listPeriods: () => [{ periodId: 'fall', kind: 'semester', label: 'Fall', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T08:00:00.000Z' }] },
    window: { from: '2026-11-02' }, timezone: TZ, clock, logger: silent,
  });
  const preview = new EarningsPreviewService({
    rules: { get: async () => RULES },
    schoolEvidence: new SchoolEarningEvidence({ termVerdicts, sessions: { execute: async () => [] }, logger: silent }),
    ringEvidence: { standings: async ({ learnerIds }) => learnerIds.map((learnerId, i) => ({ learnerId, rings: i * 100, sessions: [] })) },
    learners: async () => LEARNERS.map((id) => ({ id, name: id })),
    clock, timezone: TZ, logger: silent,
  });
  const economy = { hasUser: () => true, getHistory: async () => [], peekBalance: async () => ({ silver: 1, gold: 0, gems: 0 }) };
  const config = { catalog: () => ({ mode: 'live' }) };
  const gemBoard = new GemBoardService({ preview, rules: { get: async () => RULES }, economy, config, logger: silent });
  const standings = new WorkoutEarningsService({ preview, economy, config, gemBoard, logger: silent });
  // Older days cached, as in production; then today's and yesterday's rows go stale.
  for (const id of LEARNERS) await termVerdicts.rebuild(id);
  offset += 61_000;
  projections.length = 0;
  return { preview, gemBoard, standings, projections };
}

// Four learners × (today, yesterday): what one priced roster has to project.
const ONE_ROSTER = LEARNERS.length * 2;

describe('standings and Gem Board read cost', () => {
  it('GET /standings projects each live day once (it priced two rosters: 16)', async () => {
    const { standings, projections } = await build();
    const t0 = Date.now();
    const res = await standings.standings();
    const ms = Date.now() - t0;
    expect(projections).toHaveLength(ONE_ROSTER);
    expect(new Set(projections).size).toBe(ONE_ROSTER);
    expect(res.learners.map((l) => l.learnerId)).toEqual(LEARNERS);
    // Timing guard: one roster's worth of serialized projections, not two (with slack for a busy host).
    expect(ms).toBeLessThan(ONE_ROSTER * STEP_MS * 2 - STEP_MS);
  });

  it('standings, the Gem Board and the preview read at once share one projection per live day (was 32)', async () => {
    const { standings, gemBoard, preview, projections } = await build();
    const [s, board, roster] = await Promise.all([standings.standings(), gemBoard.board({ fresh: true }), preview.roster()]);
    expect(projections).toHaveLength(ONE_ROSTER);
    expect(roster.learners).toHaveLength(LEARNERS.length);
    expect(board.learners).toHaveLength(LEARNERS.length);
    expect(s.learners).toHaveLength(LEARNERS.length);
  });

  it('the shared roster changes nothing: standings gems equal a board read on its own', async () => {
    const { standings, gemBoard } = await build();
    const s = await standings.standings();
    const board = await gemBoard.board();
    for (const l of s.learners) {
      const held = board.categories.reduce((n, row) => n + (Number(board.cells?.[row.id]?.[l.learnerId]?.held ?? board.cells?.[row.id]?.[l.learnerId]?.week) || 0), 0);
      expect(l.gems.reduce((n, g) => n + g.held, 0)).toBe(held);
    }
    // The contest leader holds a gem, so the comparison is not vacuous.
    expect(s.learners.some((l) => l.gems.length > 0)).toBe(true);
  });
});
