import { describe, it, expect } from 'vitest';
import { loadSeedIfEmpty, readSeedFile } from '../../../../../backend/src/3_applications/agents/health-coach/playbooks/seedLoader.mjs';
import { WorkingMemoryState } from '../../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

describe('seedLoader.readSeedFile', () => {
  it('parses the YAML seed file into an array of playbook objects', async () => {
    const playbooks = await readSeedFile();
    expect(Array.isArray(playbooks)).toBe(true);
    expect(playbooks.length).toBeGreaterThanOrEqual(8);
    expect(playbooks[0]).toMatchObject({
      id: expect.any(String),
      fact: expect.any(String),
      recipe: expect.any(String),
    });
    expect(playbooks.map(p => p.id)).toContain('under-reporting-calories');
  });

  it('every playbook has id, fact, and recipe', async () => {
    const playbooks = await readSeedFile();
    for (const p of playbooks) {
      expect(p.id).toBeTruthy();
      expect(p.fact).toBeTruthy();
      expect(p.recipe).toBeTruthy();
    }
  });
});

describe('seedLoader.loadSeedIfEmpty', () => {
  it('writes seed playbooks when memory has none', async () => {
    const memory = new WorkingMemoryState();
    const result = await loadSeedIfEmpty(memory);
    expect(result.loaded).toBe(true);
    expect(memory.get('playbooks').length).toBeGreaterThanOrEqual(8);
  });

  it('does NOT overwrite existing playbooks', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'pre-existing', fact: 'x', recipe: 'y' }]);
    const result = await loadSeedIfEmpty(memory);
    expect(result.loaded).toBe(false);
    expect(memory.get('playbooks')).toEqual([{ id: 'pre-existing', fact: 'x', recipe: 'y' }]);
  });
});
