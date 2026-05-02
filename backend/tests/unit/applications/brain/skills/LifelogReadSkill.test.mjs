import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LifelogReadSkill } from '../../../../../src/3_applications/brain/skills/LifelogReadSkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeLifelog {
  async recentEntries({ days }) {
    return [{ date: '2026-04-30', kind: 'note', summary: `last ${days}d`, source: 'test' }];
  }
  async queryJournal({ text }) {
    return [{ date: '2026-04-30', excerpt: text, score: 1 }];
  }
}

describe('LifelogReadSkill', () => {
  const skill = new LifelogReadSkill({ lifelog: new FakeLifelog(), logger: silentLogger });

  it('exposes recent_lifelog_entries and query_journal', () => {
    const names = skill.getTools().map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['query_journal', 'recent_lifelog_entries']);
  });

  it('caps days at max_days', async () => {
    const tool = skill.getTools().find((t) => t.name === 'recent_lifelog_entries');
    const r = await tool.execute({ days: 999 }, {});
    assert.match(r.entries[0].summary, /14d/);
  });

  it('query_journal returns hits', async () => {
    const tool = skill.getTools().find((t) => t.name === 'query_journal');
    const r = await tool.execute({ text: 'taco' }, {});
    assert.strictEqual(r.hits[0].excerpt, 'taco');
  });

  it('throws without ILifelogRead', () => {
    assert.throws(() => new LifelogReadSkill({ lifelog: {} }), /ILifelogRead/);
  });
});
