import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '@/lib/api.mjs';
import { fetchExperienceContent, finishSession, sendRuleCommand } from './sessionClient.js';

describe('gaming session client', () => {
  beforeEach(() => DaylightAPI.mockReset());

  it('commits commands against the current authoritative revision', async () => {
    DaylightAPI
      .mockResolvedValueOnce({ header: { revision: 7 } })
      .mockResolvedValueOnce({ state: { phase: 'next' } });

    await sendRuleCommand('game:1', { type: 'advance' }, { actorId: 'player:1' });

    expect(DaylightAPI).toHaveBeenNthCalledWith(1, 'api/v1/gaming/sessions/game:1');
    expect(DaylightAPI).toHaveBeenNthCalledWith(2, 'api/v1/gaming/sessions/game:1/commands', expect.objectContaining({
      actor_id: 'player:1',
      expected_revision: 7,
      command: { type: 'advance' },
    }), 'POST');
  });

  it('loads authored content independently of an environment', async () => {
    await fetchExperienceContent('dice', 'standard');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gaming/experiences/dice/content/standard');
  });

  it('closes through the canonical endpoint', async () => {
    await finishSession('game:1');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gaming/sessions/game:1/close', { reason: 'experience_complete' }, 'POST');
  });
});
