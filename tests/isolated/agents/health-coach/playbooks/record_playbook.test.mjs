// tests/isolated/agents/health-coach/playbooks/record_playbook.test.mjs
import { describe, it, expect } from 'vitest';
import { PlaybookToolFactory } from '../../../../../backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs';
import { WorkingMemoryState } from '../../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

describe('record_playbook', () => {
  it('writes a new playbook to memory.playbooks', async () => {
    const memory = new WorkingMemoryState();
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    const r = await tool.execute(
      { id: 'test-pattern', fact: 'Test pattern fact.', recipe: 'Step 1: ...' },
      { memory }
    );
    expect(r.ok).toBe(true);
    expect(memory.get('playbooks')).toHaveLength(1);
    expect(memory.get('playbooks')[0]).toMatchObject({
      id: 'test-pattern', fact: 'Test pattern fact.', confidence: 'unverified',
    });
  });

  it('replaces existing playbook with same id', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'a', fact: 'old', recipe: 'old' }]);
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    await tool.execute({ id: 'a', fact: 'new', recipe: 'new' }, { memory });
    expect(memory.get('playbooks')).toHaveLength(1);
    expect(memory.get('playbooks')[0].fact).toBe('new');
  });

  it('rejects when id missing', async () => {
    const memory = new WorkingMemoryState();
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    const r = await tool.execute({ fact: 'x', recipe: 'y' }, { memory });
    expect(r.error).toMatch(/id/);
  });

  it('rejects when memory is missing from context', async () => {
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'record_playbook');
    const r = await tool.execute({ id: 'a', fact: 'b', recipe: 'c' }, {});
    expect(r.error).toMatch(/memory/);
  });
});
