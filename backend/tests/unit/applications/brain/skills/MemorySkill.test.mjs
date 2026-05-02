import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemorySkill } from '../../../../../src/3_applications/brain/skills/MemorySkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class InMemoryBrainMemory {
  constructor() { this.store = {}; }
  async get(k) { return this.store[k] ?? null; }
  async set(k, v) { this.store[k] = v; }
  async merge(k, p) {
    const c = this.store[k];
    this.store[k] = (c && typeof c === 'object') ? { ...c, ...p } : p;
  }
}

describe('MemorySkill', () => {
  it('exposes remember_note and recall_note', () => {
    const s = new MemorySkill({ memory: new InMemoryBrainMemory(), logger: silentLogger });
    const names = s.getTools().map((t) => t.name);
    assert.deepStrictEqual(names.sort(), ['recall_note', 'remember_note']);
  });

  it('remember_note appends to the notes list', async () => {
    const mem = new InMemoryBrainMemory();
    const s = new MemorySkill({ memory: mem, logger: silentLogger });
    const remember = s.getTools().find((t) => t.name === 'remember_note');
    await remember.execute({ content: 'Soren is allergic to peanuts' }, {});
    const notes = await mem.get('notes');
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0].content, /peanuts/);
  });

  it('recall_note returns recent notes (limited)', async () => {
    const mem = new InMemoryBrainMemory();
    await mem.set('notes', [
      { content: 'A', t: '2024-01-01T00:00:00Z' },
      { content: 'B', t: '2024-01-02T00:00:00Z' },
    ]);
    const s = new MemorySkill({ memory: mem, logger: silentLogger });
    const recall = s.getTools().find((t) => t.name === 'recall_note');
    const result = await recall.execute({ limit: 1 }, {});
    assert.strictEqual(result.notes.length, 1);
    assert.match(result.notes[0].content, /B/);
  });

  it('remember_note rejects empty content', async () => {
    const s = new MemorySkill({ memory: new InMemoryBrainMemory(), logger: silentLogger });
    const remember = s.getTools().find((t) => t.name === 'remember_note');
    const r = await remember.execute({ content: '' }, {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'empty_note');
  });

  it('remember_note caps notes at maxNotes', async () => {
    const mem = new InMemoryBrainMemory();
    const s = new MemorySkill({ memory: mem, logger: silentLogger, config: { maxNotes: 2 } });
    const remember = s.getTools().find((t) => t.name === 'remember_note');
    await remember.execute({ content: 'a' }, {});
    await remember.execute({ content: 'b' }, {});
    await remember.execute({ content: 'c' }, {});
    const notes = await mem.get('notes');
    assert.strictEqual(notes.length, 2);
    assert.deepStrictEqual(notes.map((n) => n.content), ['b', 'c']);
  });
});
