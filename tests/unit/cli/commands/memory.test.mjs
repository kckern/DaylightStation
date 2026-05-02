// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import memory from '../../../../cli/commands/memory.mjs';

function makeBuffers() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new Writable({ write(c, _e, cb) { stdoutChunks.push(c); cb(); } });
  stdout.read = () => Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = new Writable({ write(c, _e, cb) { stderrChunks.push(c); cb(); } });
  stderr.read = () => Buffer.concat(stderrChunks).toString('utf8');
  return { stdout, stderr };
}

/**
 * Build a fake YamlConciergeMemoryAdapter-shaped object whose `__workingMemory`
 * exposes a .load(agentId, userId) returning a WorkingMemoryState-like object
 * with .getAll() — matching the real API.
 */
function fakeMemory(initialState = {}) {
  const state = { ...initialState };
  const workingMemory = {
    async load(_agentId, _userId) {
      return { getAll: () => state };
    },
  };
  return {
    async get(key) { return state[key] ?? null; },
    async set(key, value) { state[key] = value; },
    __workingMemory: workingMemory,
  };
}

describe('cli/commands/memory', () => {
  describe('get action', () => {
    it('emits JSON wrapping the value for an existing key', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({ notes: ['call dad', 'pick up groceries'] });

      const result = await memory.run(
        { subcommand: 'memory', positional: ['get', 'notes'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.key).toBe('notes');
      expect(out.value).toEqual(['call dad', 'pick up groceries']);
    });

    it('exits 1 with not_found when key is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({});

      const result = await memory.run(
        { subcommand: 'memory', positional: ['get', 'unknown_key'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(1);
      const err = JSON.parse(stderr.read().trim());
      expect(err.error).toBe('not_found');
      expect(err.key).toBe('unknown_key');
    });

    it('exits 2 when key is missing', async () => {
      const { stdout, stderr } = makeBuffers();
      const result = await memory.run(
        { subcommand: 'memory', positional: ['get'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => fakeMemory({}) },
      );
      expect(result.exitCode).toBe(2);
      expect(stderr.read()).toMatch(/key/i);
    });
  });

  describe('list action', () => {
    it('emits JSON with all keys and a values dump', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({ notes: ['a'], preferences: { dietary: 'low-carb' } });

      const result = await memory.run(
        { subcommand: 'memory', positional: ['list'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.keys).toEqual(expect.arrayContaining(['notes', 'preferences']));
      expect(out.count).toBe(2);
      expect(out.values).toEqual({ notes: ['a'], preferences: { dietary: 'low-carb' } });
    });

    it('emits empty list for empty memory', async () => {
      const { stdout, stderr } = makeBuffers();
      const mem = fakeMemory({});

      const result = await memory.run(
        { subcommand: 'memory', positional: ['list'], flags: {}, help: false },
        { stdout, stderr, getMemory: async () => mem },
      );

      expect(result.exitCode).toBe(0);
      const out = JSON.parse(stdout.read().trim());
      expect(out.keys).toEqual([]);
      expect(out.count).toBe(0);
    });
  });

  describe('help', () => {
    it('returns exit 0 with usage to stdout when help=true', async () => {
      const { stdout } = makeBuffers();
      const result = await memory.run(
        { subcommand: 'memory', positional: [], flags: {}, help: true },
        { stdout, stderr: makeBuffers().stderr },
      );
      expect(result.exitCode).toBe(0);
      expect(stdout.read()).toMatch(/get/);
      expect(stdout.read()).toMatch(/list/);
    });
  });
});
