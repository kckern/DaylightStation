import { describe, expect, it } from 'vitest';
import {
  CheckpointedLocalAuthority,
  createEphemeralPorts,
  defineRuleModule,
  EphemeralAuthority,
  GameRuntime,
  GameSessionCoordinator,
  RemoteAuthority,
  SessionActorAuthorization,
} from './index.mjs';
import { MemorySessionJournal, MemorySnapshotRepository } from '../testing/memoryPorts.mjs';

const rules = defineRuleModule({
  id: 'authority-test', version: 1,
  validateDefinition: () => ({ valid: true, errors: [] }),
  createInitialState: () => ({ status: 'active', count: 0 }),
  handleCommand: (state, command) => ({ state: { ...state, count: state.count + command.amount }, events: [{ type: 'count.changed', amount: command.amount }] }),
  project: (state) => ({ state }),
});

function coordinator(ports) {
  const definition = { id: 'authority-definition' };
  return new GameSessionCoordinator({
    runtime: new GameRuntime({ rulesets: [rules] }), ...ports,
    definitions: { getCurrent: async () => ({ definition, hash: 'b'.repeat(64) }), pin: async () => ({ definition, hash: 'b'.repeat(64) }), getPinned: async () => definition },
    ids: { session: () => 'authority:1', command: () => 'authority:close', seed: () => 11 },
    clock: { now: () => new Date('2026-08-24T00:00:00Z') }, authorization: new SessionActorAuthorization(),
  });
}

const request = { ruleset: { id: 'authority-test', version: 1 }, definitionId: 'authority-definition', participants: [{ id: 'p1' }] };
const envelope = { command_id: 'authority:add', actor_id: 'p1', expected_revision: 0, logical_time: 1, command: { type: 'add', amount: 3 } };

async function assertConformance(authority) {
  const created = await authority.create(request); expect(created.header.revision).toBe(0);
  const observed = []; const stop = await authority.observe('authority:1', (session) => observed.push(session.header.revision));
  const committed = await authority.dispatch('authority:1', envelope, { participant_id: 'p1' });
  expect(committed).toMatchObject({ header: { revision: 1 }, state: { count: 3 } }); expect(observed).toEqual([1]); stop();
  await expect(authority.resume('authority:1', { participant_id: 'p1' })).resolves.toMatchObject({ state: { count: 3 } });
  await expect(authority.close('authority:1')).resolves.toMatchObject({ header: { status: 'complete', revision: 2 } });
}

describe('authority strategy conformance', () => {
  it('conforms for checkpointed-local authority', async () => {
    await assertConformance(new CheckpointedLocalAuthority({ coordinator: coordinator({ snapshots: new MemorySnapshotRepository(), journal: new MemorySessionJournal() }) }));
  });

  it('conforms for ephemeral authority with process-memory ports', async () => {
    await assertConformance(new EphemeralAuthority({ coordinator: coordinator(createEphemeralPorts()) }));
  });

  it('conforms for remote authority through the transport protocol', async () => {
    const target = coordinator(createEphemeralPorts());
    await assertConformance(new RemoteAuthority({ transport: {
      create: (value) => target.create(value), resume: (id, viewer) => target.resume(id, viewer),
      dispatch: (id, command, viewer) => target.dispatch(id, command, viewer), observe: (id, listener) => target.observe(id, listener),
      close: (id, options) => target.close(id, options),
    } }));
  });
});
