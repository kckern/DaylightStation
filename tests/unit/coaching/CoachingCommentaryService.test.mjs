import { describe, it, expect, vi } from 'vitest';
import { CoachingCommentaryService } from '../../../backend/src/3_applications/coaching/CoachingCommentaryService.mjs';

describe('CoachingCommentaryService', () => {
  function makeMockAgent(response) {
    return {
      generate: vi.fn().mockResolvedValue({ text: response }),
    };
  }

  function makeMockAgentFactory(agent) {
    return () => agent;
  }

  it('returns commentary from LLM', async () => {
    const agent = makeMockAgent('That chicken hit hard.');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report', calories: { consumed: 850 } });
    expect(result).toBe('That chicken hit hard.');
    expect(agent.generate).toHaveBeenCalledOnce();
  });

  it('passes snapshot as JSON string to agent', async () => {
    const agent = makeMockAgent('Nice.');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const snapshot = { type: 'post-report', calories: { consumed: 850 } };
    await service.generate(snapshot);

    const input = agent.generate.mock.calls[0][0];
    expect(JSON.parse(input)).toEqual(snapshot);
  });

  it('returns empty string when LLM returns empty', async () => {
    const agent = makeMockAgent('');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report' });
    expect(result).toBe('');
  });

  it('returns empty string when LLM throws', async () => {
    const agent = { generate: vi.fn().mockRejectedValue(new Error('timeout')) };
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report' });
    expect(result).toBe('');
  });

  it('strips HTML tags from LLM output', async () => {
    const agent = makeMockAgent('<b>Bold</b> commentary <blockquote>no</blockquote>');
    const service = new CoachingCommentaryService({ agentFactory: makeMockAgentFactory(agent), logger: console });

    const result = await service.generate({ type: 'post-report' });
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('<blockquote>');
  });
});
