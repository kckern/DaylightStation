import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FitnessReadSkill } from '../../../../../src/3_applications/brain/skills/FitnessReadSkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeFit {
  async recentWorkouts({ days }) { return [{ date: '2026-04-30', type: 'run', durationSec: 1800, source: 'strava', _days: days }]; }
  async fitnessSummary({ periodDays }) { return { totalMinutes: periodDays * 30, byType: { run: periodDays }, asOf: '2026-04-30' }; }
}

describe('FitnessReadSkill', () => {
  const s = new FitnessReadSkill({ fitness: new FakeFit(), logger: silentLogger });

  it('exposes recent_workouts and fitness_summary', () => {
    const names = s.getTools().map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['fitness_summary', 'recent_workouts']);
  });

  it('recent_workouts defaults days=7', async () => {
    const tool = s.getTools().find((t) => t.name === 'recent_workouts');
    const r = await tool.execute({}, {});
    assert.strictEqual(r.workouts[0]._days, 7);
  });

  it('fitness_summary defaults periodDays=30', async () => {
    const tool = s.getTools().find((t) => t.name === 'fitness_summary');
    const r = await tool.execute({}, {});
    assert.strictEqual(r.totalMinutes, 30 * 30);
  });

  it('throws without IFitnessRead', () => {
    assert.throws(() => new FitnessReadSkill({ fitness: {} }), /IFitnessRead/);
  });
});
