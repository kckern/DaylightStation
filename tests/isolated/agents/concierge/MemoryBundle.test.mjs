import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBundle } from '../../../../backend/src/3_applications/agents/concierge/skills/MemoryBundle.mjs';

// Minimal WorkingMemoryState stand-in
function makeMemoryState(initial = {}) {
  const data = { ...initial };
  return {
    get: (key) => data[key] ?? null,
    set: (key, value) => { data[key] = value; },
    remove: (key) => { delete data[key]; },
    _data: data,
  };
}

describe('MemoryBundle', () => {
  it('satisfies ToolBundle contract', () => {
    const bundle = new MemoryBundle({});
    expect(typeof bundle.name).toBe('string');
    expect(typeof bundle.createTools).toBe('function');
  });

  it('name is "memory"', () => {
    expect(new MemoryBundle({}).name).toBe('memory');
  });

  it('getPromptFragment returns a non-empty string', () => {
    const frag = new MemoryBundle({}).getPromptFragment({});
    expect(typeof frag).toBe('string');
    expect(frag.length).toBeGreaterThan(0);
  });

  describe('remember_note tool', () => {
    let tool, state, context;
    beforeEach(() => {
      state = makeMemoryState();
      context = { memory: state };
      tool = new MemoryBundle({}).createTools().find(t => t.name === 'remember_note');
    });

    it('appends a note to context.memory', async () => {
      const result = await tool.execute({ content: 'Dogs are allowed' }, context);
      expect(result.ok).toBe(true);
      const notes = state.get('notes');
      expect(Array.isArray(notes)).toBe(true);
      expect(notes[0].content).toBe('Dogs are allowed');
    });

    it('trims content to 280 characters', async () => {
      const longContent = 'x'.repeat(400);
      await tool.execute({ content: longContent }, context);
      const notes = state.get('notes');
      expect(notes[0].content.length).toBe(280);
    });

    it('returns ok: false for empty content', async () => {
      const result = await tool.execute({ content: '' }, context);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('empty_note');
    });

    it('caps notes at maxNotes', async () => {
      const bundle = new MemoryBundle({ config: { maxNotes: 3 } });
      const t = bundle.createTools().find(t => t.name === 'remember_note');
      for (let i = 0; i < 5; i++) {
        await t.execute({ content: `note ${i}` }, context);
      }
      expect(state.get('notes')).toHaveLength(3);
    });
  });

  describe('recall_note tool', () => {
    it('returns the last N notes', async () => {
      const state = makeMemoryState({ notes: [
        { content: 'a', t: '2026-01-01T00:00:00Z' },
        { content: 'b', t: '2026-01-02T00:00:00Z' },
        { content: 'c', t: '2026-01-03T00:00:00Z' },
      ]});
      const context = { memory: state };
      const tool = new MemoryBundle({}).createTools().find(t => t.name === 'recall_note');
      const result = await tool.execute({ limit: 2 }, context);
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0].content).toBe('b');
      expect(result.notes[1].content).toBe('c');
    });

    it('returns empty array when no notes saved', async () => {
      const context = { memory: makeMemoryState() };
      const tool = new MemoryBundle({}).createTools().find(t => t.name === 'recall_note');
      const result = await tool.execute({}, context);
      expect(result.notes).toEqual([]);
    });
  });
});
