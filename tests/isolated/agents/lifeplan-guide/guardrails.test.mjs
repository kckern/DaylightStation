import { describe, it, expect } from '@jest/globals';
import { systemPrompt } from '#apps/agents/lifeplan-guide/prompts/system.mjs';

describe('LifeplanGuide Guardrails', () => {
  it('system prompt defines scope boundaries', () => {
    expect(systemPrompt).toContain('OUT OF SCOPE');
    expect(systemPrompt).toContain('Mental health');
    expect(systemPrompt).toContain('medical advice');
  });

  it('system prompt enforces propose-then-confirm pattern', () => {
    expect(systemPrompt).toContain('propose_*');
    expect(systemPrompt).toContain('NEVER modify the plan directly');
  });

  it('system prompt includes trust levels', () => {
    expect(systemPrompt).toContain('Trust Levels');
    expect(systemPrompt).toContain('New');
    expect(systemPrompt).toContain('Building');
    expect(systemPrompt).toContain('Established');
  });

  it('system prompt includes deflection protocol', () => {
    expect(systemPrompt).toContain('Acknowledge');
    expect(systemPrompt).toContain('professional resources');
  });
});
