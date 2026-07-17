import { describe, it, expect } from 'vitest';
import { systemPrompt } from '#apps/agents/lifeplan-guide/prompts/system.mjs';

describe('LifeplanGuide Guardrails', () => {
  it('system prompt defines scope boundaries', () => {
    expect(systemPrompt).toContain('OUT OF SCOPE');
    expect(systemPrompt).toContain('Mental health');
    expect(systemPrompt).toContain('medical advice');
  });

  it('system prompt enforces confirm-before-write pattern honestly (no confirmation-card fiction)', () => {
    expect(systemPrompt).not.toContain('propose_');
    expect(systemPrompt).toContain('There are no separate "confirmation cards"');
    expect(systemPrompt).toContain('transition_goal');
    expect(systemPrompt).toContain('add_evidence');
    // Direct create/write tools may write, but only after explicit conversational confirmation.
    expect(systemPrompt).toContain("never write to the plan without the user's explicit confirmation");
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
