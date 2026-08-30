import { describe, expect, it } from 'vitest';
import { buildCreatePayload, defaultSeats, diagnosticUrl, parseCliArgs, patchFromSetFlags } from './party-games.cli.mjs';

describe('party-games diagnostic CLI', () => {
  it('builds stable default seats without mutating the profile', () => {
    const profile = { team_presets: [{ teams: [{ name: 'Kids', members: [{ id: 'a' }] }, { name: 'Adults', members: [{ id: 'b' }] }] }] };
    expect(defaultSeats(profile)).toEqual([
      expect.objectContaining({ id: 'team_1', slot: 'slot_1', name: 'Kids', members: [{ id: 'a' }] }),
      expect.objectContaining({ id: 'team_2', slot: 'slot_2', name: 'Adults', members: [{ id: 'b' }] }),
    ]);
    expect(profile.team_presets[0].teams[0]).not.toHaveProperty('id');
  });

  it('derives verifier setup only for non-human host modes', () => {
    const entry = { definition_id: 'activity:test', setup: 'individuals-or-teams', setup_profile: { kind: 'individuals-or-teams', host_modes: ['human', 'computer'], verifier: 'opponent' } };
    const profile = { team_presets: [{ teams: [{ name: 'One', members: [{ id: 'a' }] }, { name: 'Two', members: [{ id: 'b' }] }] }] };
    expect(buildCreatePayload({ entry, profile, hostMode: 'computer', seed: 42 })).toMatchObject({
      definition_id: 'activity:test', seed: 42,
      setup: { host: { mode: 'computer' }, verifier_id: 'b' },
    });
  });

  it('parses repeatable dotted overrides and produces an encoded attach URL', () => {
    expect(patchFromSetFlags(['phase="performing"', 'challenge.prompt="Tree"', 'scores.team_1=9', 'deadline=null'])).toEqual({
      phase: 'performing', challenge: { prompt: 'Tree' }, scores: { team_1: 9 }, deadline: null,
    });
    expect(diagnosticUrl('http://localhost:3111/', 'diagnostic:a:b')).toBe('http://localhost:3111/app/party-games?diagnostic_session=diagnostic%3Aa%3Ab');
    expect(parseCliArgs(['advance', 'diagnostic:x', 'dice.roll', '--data', '{"notation":"2d6"}', '--actor', 'host']).flags.data).toEqual({ notation: '2d6' });
  });
});
