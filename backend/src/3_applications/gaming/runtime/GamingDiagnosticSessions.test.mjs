import { describe, expect, it } from 'vitest';
import { GameRuntime, SessionActorAuthorization } from '#shared/gaming/kernel/index.mjs';
import { diceRuleModule } from '#shared/gaming/rulesets/dice/index.mjs';
import { GamingDiagnosticSessions } from './GamingDiagnosticSessions.mjs';

const HASH = 'a'.repeat(64);

function fixture() {
  const definition = {
    rule_module: { id: 'dice', version: 1 },
    experience: { id: 'dice', version: 1 },
    title: 'Diagnostic Dice',
    default_notation: '1d6',
    presets: ['1d6'],
  };
  const definitions = {
    getCurrent: async (id) => id === 'dice:test' ? { definition, hash: HASH, artifacts: {} } : null,
    pin: () => { throw new Error('diagnostic sessions must not archive definitions'); },
  };
  const manifest = {
    id: 'dice', version: 1, hash: 'b'.repeat(64), setup: { kind: 'none' },
    surfaces: [{ id: 'party-games', presenter: 'polyhedral-dice' }],
  };
  let command = 0;
  const ids = { session: () => 'game:test', command: () => `cmd:${++command}`, seed: () => 7 };
  let now = 1_000;
  const clock = { now: () => new Date(now++) };
  const service = new GamingDiagnosticSessions({
    runtime: new GameRuntime({ rulesets: [diceRuleModule] }), definitions,
    manifestStore: { get: (id, version) => id === 'dice' && version === 1 ? manifest : null },
    ids, authorization: new SessionActorAuthorization(), clock,
  });
  return service;
}

describe('GamingDiagnosticSessions', () => {
  it('advances and overrides process-memory state with an inspectable history', async () => {
    const service = fixture();
    const viewer = { role: 'host' };
    const created = await service.createSession({ definitionId: 'dice:test', surfaceId: 'party-games', viewer });
    expect(created).toMatchObject({
      header: { session_id: 'diagnostic:test', revision: 0, launch: { authority_mode: 'ephemeral' } },
      diagnostic: { ephemeral: true, presenter_id: 'polyhedral-dice' },
      state: { roll_count: 0, outcome: null },
    });

    const advanced = service.advance('diagnostic:test', { command: { type: 'dice.roll', notation: '1d6' } }, viewer);
    expect(advanced).toMatchObject({ header: { revision: 1 }, state: { roll_count: 1 } });

    const overridden = service.overrideState('diagnostic:test', { outcome: { total: 99 }, phase: 'showcase' }, viewer);
    expect(overridden).toMatchObject({ header: { revision: 2 }, state: { outcome: { total: 99 }, phase: 'showcase' } });
    expect(service.inspect('diagnostic:test', viewer).diagnostic.history.map((entry) => entry.kind)).toEqual(['created', 'command', 'override']);
    expect(service.listSessions(viewer)).toEqual([expect.objectContaining({ session_id: 'diagnostic:test', phase: 'showcase', revision: 2 })]);
  });

  it('requires host authority for overrides and deletes without a persistence adapter', async () => {
    const service = fixture();
    await service.createSession({ definitionId: 'dice:test', surfaceId: 'party-games', viewer: { role: 'host' } });
    expect(() => service.overrideState('diagnostic:test', { roll_count: 2 }, { role: 'participant', participant_id: 'p1' })).toThrow(/host authority/);
    expect(service.deleteSession('diagnostic:test', { role: 'host' })).toEqual({ deleted: true });
    expect(() => service.inspect('diagnostic:test', { role: 'host' })).toThrow(/not found/);
  });
});
