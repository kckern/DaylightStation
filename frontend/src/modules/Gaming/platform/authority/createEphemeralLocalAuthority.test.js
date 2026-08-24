import { describe, expect, it } from 'vitest';
import { defineRuleModule } from '@shared-gaming/kernel/index.mjs';
import { createEphemeralLocalAuthority } from './createEphemeralLocalAuthority.js';

const ruleset = defineRuleModule({
  id: 'ephemeral-fixture', version: 1,
  validateDefinition: () => ({ valid: true, errors: [] }),
  createInitialState: () => ({ status: 'active', count: 0 }),
  handleCommand: (state, command) => ({ state: { ...state, count: state.count + command.amount }, events: [{ type: 'count.changed' }] }),
  project: (state) => ({ state }),
});

describe('createEphemeralLocalAuthority', () => {
  it('provides the complete coordinator protocol without durable storage', async () => {
    const authority = createEphemeralLocalAuthority({ ruleset, definition: { id: 'fixture' }, clock: { now: () => new Date('2026-08-24T00:00:00Z') } });
    const created = await authority.create({
      ruleset: { id: ruleset.id, version: ruleset.version }, definitionId: 'fixture',
      participants: [{ id: 'local-player', role: 'player' }], viewer: { participant_id: 'local-player', role: 'player' },
    });
    const committed = await authority.dispatch(created.header.session_id, {
      command_id: 'fixture:add', actor_id: 'local-player', expected_revision: 0,
      logical_time: 1, command: { type: 'fixture.add', amount: 2 },
    }, { participant_id: 'local-player', role: 'player' });
    expect(authority.kind).toBe('ephemeral');
    expect(committed).toMatchObject({ header: { revision: 1 }, state: { count: 2 } });
    await expect(authority.resume(created.header.session_id, { participant_id: 'local-player', role: 'player' }))
      .resolves.toMatchObject({ state: { count: 2 } });
  });
});
