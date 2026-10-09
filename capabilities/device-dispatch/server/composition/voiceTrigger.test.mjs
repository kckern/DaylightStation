import { describe, it, expect, vi } from 'vitest';
import { createVoiceTriggerService } from './voiceTrigger.mjs';

const config = {
  voice: { locations: { kitchen: {
    target: 'kitchen-display', auth_token: null, routing: { mode: 'route', confidenceFloor: null },
    commands: { play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' } },
  } } },
};
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('createVoiceTriggerService', () => {
  it('without a decision gateway, exact keywords still dispatch and free text is no match', async () => {
    const triggerDispatchService = { handleTrigger: vi.fn(async () => ({ ok: true })) };
    const svc = createVoiceTriggerService({ config, decisionGateway: null, triggerDispatchService, createProposalId: () => 'p', logger: silent });
    expect((await svc.handleTranscript('kitchen', 'play jazz')).ok).toBe(true);
    expect((await svc.handleTranscript('kitchen', 'some jazz please')).code).toBe('VOICE_NO_MATCH');
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledTimes(1);
  });

  it('with a decision gateway, free text is routed through it', async () => {
    const decisionGateway = {
      isConfigured: () => true,
      evaluate: vi.fn(async () => ({ model: 'm', answers: { command: { type: 'choice', choice: 'play_jazz', confidence: 0.9, probabilities: {} } } })),
    };
    const triggerDispatchService = { handleTrigger: vi.fn(async () => ({ ok: true })) };
    const svc = createVoiceTriggerService({ config, decisionGateway, triggerDispatchService, createProposalId: () => 'p', logger: silent });
    expect((await svc.handleTranscript('kitchen', 'some jazz please')).ok).toBe(true);
    expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', expect.any(Object));
  });
});
