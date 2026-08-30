import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '@/lib/api.mjs';
import { createSession, fetchBoot } from './sessionClient.js';

describe('party-games session client', () => {
  beforeEach(() => DaylightAPI.mockReset());

  it('loads an entirely mounted party-games catalog', async () => {
    DaylightAPI.mockResolvedValueOnce({ defaults: {} }).mockResolvedValueOnce({ entries: [{
      definition_id: 'quiz:s1', content_id: 's1', experience_id: 'quiz', title: 'Quiz',
      setup: 'teams', setup_profile: { kind: 'teams' }, valid: true,
    }] });
    const boot = await fetchBoot();
    expect(boot).toMatchObject({ config: { defaults: {} } });
    expect(boot.sets).toEqual([expect.objectContaining({ game: 'quiz', setId: 's1', definitionId: 'quiz:s1', setup: 'teams' })]);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gaming/environments/party-games/profile');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gaming/environments/party-games/catalog');
  });

  it('creates a session by mounted definition identity only', async () => {
    DaylightAPI.mockResolvedValueOnce({ header: { session_id: 'game:1' } });
    await createSession({ definitionId: 'quiz:s1', seats: [{ id: 'red', members: [] }], setupProfile: { kind: 'teams' } });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gaming/sessions', {
      definition_id: 'quiz:s1', surface_id: 'party-games', participants: [], seats: [{ id: 'red', members: [] }], setup: { seats: [{ id: 'red', members: [] }], teams: [{ id: 'red', members: [] }] },
    }, 'POST');
  });

  it('loads only diagnostic-prefixed sessions for a non-persistent attach', async () => {
    DaylightAPI.mockResolvedValueOnce({ defaults: {} }).mockResolvedValueOnce({ entries: [] }).mockResolvedValueOnce({ header: { session_id: 'diagnostic:one' } });
    await expect(fetchBoot({ diagnosticSessionId: 'diagnostic:one' })).resolves.toMatchObject({ diagnosticSession: { header: { session_id: 'diagnostic:one' } } });
    expect(DaylightAPI).toHaveBeenLastCalledWith('api/v1/gaming/sessions/diagnostic%3Aone');
    await expect(fetchBoot({ diagnosticSessionId: 'game:real' })).rejects.toThrow(/diagnostic: prefix/);
  });

  it('attaches an ordinary resumable session without requiring the diagnostic prefix', async () => {
    DaylightAPI.mockResolvedValueOnce({ defaults: {} }).mockResolvedValueOnce({ entries: [] }).mockResolvedValueOnce({ header: { session_id: 'game:real' } });
    await expect(fetchBoot({ sessionId: 'game:real' })).resolves.toMatchObject({ attachedSession: { header: { session_id: 'game:real' } } });
    expect(DaylightAPI).toHaveBeenLastCalledWith('api/v1/gaming/sessions/game%3Areal');
  });

  it('derives verifier policy while leaving environment candidate sourcing to the server', async () => {
    DaylightAPI.mockResolvedValueOnce({ header: { session_id: 'game:2' } });
    const teams = [{ id: 'one', members: [{ id: 'a' }] }, { id: 'two', members: [{ id: 'b' }] }];
    await createSession({ definitionId: 'drawing:family', seats: teams, config: { household_members: [{ id: 'a' }] }, hostMode: 'computer', setupProfile: { kind: 'individuals-or-teams', host_modes: ['computer'], verifier: 'opponent', candidate_source: 'household-members' } });
    expect(DaylightAPI.mock.calls[0][1].setup).toEqual({ seats: teams, teams, host: { mode: 'computer' }, verifier_id: 'b' });
  });

});
