// tests/isolated/agents/health-coach/playbooks/update_playbook.test.mjs
import { describe, it, expect } from 'vitest';
import { PlaybookToolFactory } from '../../../../../backend/src/3_applications/agents/health-coach/tools/PlaybookToolFactory.mjs';
import { WorkingMemoryState } from '../../../../../backend/src/3_applications/agents/framework/WorkingMemory.mjs';

describe('update_playbook', () => {
  it('updates last_verified on existing playbook', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'a', fact: 'f', recipe: 'r' }]);
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'update_playbook');
    const r = await tool.execute({
      id: 'a',
      last_verified: { at: '2026-05-06T17:00Z', period: 'last_30d', result: { gap: 0.99 } },
      confidence: 'high',
    }, { memory });
    expect(r.ok).toBe(true);
    const updated = memory.get('playbooks')[0];
    expect(updated.last_verified.result.gap).toBe(0.99);
    expect(updated.confidence).toBe('high');
    expect(updated.fact).toBe('f');  // unchanged
  });

  it('errors when id not found', async () => {
    const memory = new WorkingMemoryState();
    memory.set('playbooks', [{ id: 'a', fact: 'f', recipe: 'r' }]);
    const tool = new PlaybookToolFactory().createTools().find(t => t.name === 'update_playbook');
    const r = await tool.execute({ id: 'nonexistent', notes: 'x' }, { memory });
    expect(r.error).toMatch(/not found/);
  });
});
