import { describe, expect, it, vi } from 'vitest';
import { defineRuleModule, GameRuntime, GameSessionCoordinator, RevisionConflictError, SessionActorAuthorization } from './index.mjs';
import { MemorySessionJournal, MemorySnapshotRepository } from '../testing/memoryPorts.mjs';

const counterRules = defineRuleModule({
  id: 'counter', version: 1,
  validateDefinition: (definition) => ({ valid: Number.isFinite(definition.maximum), errors: Number.isFinite(definition.maximum) ? [] : ['maximum required'] }),
  createInitialState: () => ({ status: 'active', count: 0 }),
  handleCommand(state, command, definition) {
    if (command.type !== 'counter.add' || state.count + command.amount > definition.maximum) return { error: { code: 'illegal_command', message: 'counter rejected' } };
    return { state: { ...state, count: state.count + command.amount }, events: [{ type: 'counter.added', amount: command.amount }] };
  },
  project: (state) => ({ state, interaction: { can_add: true } }),
});

function fixture() {
  const snapshots = new MemorySnapshotRepository(); const journal = new MemorySessionJournal(); const definition = { maximum: 10 };
  const definitions = { async getCurrent() { return { definition, hash: 'a'.repeat(64) }; }, async pin() { return { definition, hash: 'a'.repeat(64) }; }, async getPinned() { return definition; } };
  const ids = { session: () => 'session:1', command: () => 'command:close', seed: () => 7 };
  const coordinator = new GameSessionCoordinator({ runtime: new GameRuntime({ rulesets: [counterRules] }), snapshots, journal, definitions, ids, clock: { now: () => new Date('2026-08-24T12:00:00.000Z') }, authorization: new SessionActorAuthorization() });
  return { coordinator, snapshots, journal };
}

const envelope = (revision = 0) => ({ command_id: 'command:1', actor_id: 'participant:1', expected_revision: revision, logical_time: 1, correlation_id: 'run:1', command: { type: 'counter.add', amount: 2 } });

describe('Gaming kernel and coordinator', () => {
  it('commits deterministic events to separate snapshot and journal ports', async () => {
    const { coordinator, journal, snapshots } = fixture();
    const created = await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    expect(created.header.seed).toBe(7);
    const result = await coordinator.dispatch(created.header.session_id, envelope(), { participant_id: 'participant:1' });
    expect(result.state.count).toBe(2); expect(result.header.revision).toBe(1);
    expect((await journal.read('session:1'))[1]).toMatchObject({ command: envelope() });
  });

  it('is idempotent and fails closed on stale revisions', async () => {
    const { coordinator } = fixture(); await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    const viewer = { participant_id: 'participant:1' }; const first = await coordinator.dispatch('session:1', envelope(), viewer); const duplicate = await coordinator.dispatch('session:1', envelope(), viewer);
    expect(duplicate.duplicate).toBe(true); expect(duplicate.header.revision).toBe(first.header.revision);
    await expect(coordinator.dispatch('session:1', { ...envelope(), command_id: 'command:2' }, viewer)).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('observers receive committed snapshots only', async () => {
    const { coordinator } = fixture(); await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    const observer = vi.fn(); const stop = await coordinator.observe('session:1', observer);
    await coordinator.dispatch('session:1', envelope(), { participant_id: 'participant:1' }); stop(); expect(observer).toHaveBeenCalledOnce(); expect(observer.mock.calls[0][0].state.count).toBe(2);
  });

  it('recovers a snapshot when the journal commit won a partial failure', async () => {
    const { coordinator, snapshots } = fixture(); await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    const put = snapshots.put.bind(snapshots); let fail = true;
    snapshots.put = async (session, options) => { if (fail && options.expectedRevision === 0) { fail = false; throw new Error('disk interrupted'); } return put(session, options); };
    await expect(coordinator.dispatch('session:1', envelope(), { participant_id: 'participant:1' })).rejects.toThrow('disk interrupted');
    await expect(coordinator.resume('session:1', { participant_id: 'participant:1' })).resolves.toMatchObject({ header: { revision: 1 }, state: { count: 2 } });
  });

  it('recovers entirely from the journal when the snapshot is missing', async () => {
    const { coordinator, snapshots } = fixture();
    await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    await coordinator.dispatch('session:1', envelope(), { participant_id: 'participant:1' });
    snapshots.sessions.delete('session:1');
    await expect(coordinator.resume('session:1', { participant_id: 'participant:1' })).resolves.toMatchObject({ header: { revision: 1 }, state: { count: 2 } });
  });

  it('fails closed on unauthorized actors and divergent journal events', async () => {
    const { coordinator, journal, snapshots } = fixture();
    await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    await expect(coordinator.dispatch('session:1', { ...envelope(), actor_id: 'intruder' }, {})).rejects.toMatchObject({ code: 'authorization_denied' });
    await coordinator.dispatch('session:1', envelope(), { participant_id: 'participant:1' });
    journal.records.get('session:1')[1].events[0].event.amount = 9;
    snapshots.sessions.delete('session:1');
    await expect(coordinator.resume('session:1')).rejects.toMatchObject({ code: 'journal_corrupt' });
  });

  it('does not treat an unbound viewer as a participant and limits trusted host delegation to session actors', async () => {
    const { coordinator } = fixture();
    await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    await expect(coordinator.dispatch('session:1', envelope(), {})).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(coordinator.dispatch('session:1', envelope(), { role: 'host', participant_id: 'different-host' })).resolves.toMatchObject({ state: { count: 2 } });
    await expect(coordinator.dispatch('session:1', {
      ...envelope(1), command_id: 'command:intruder', actor_id: 'intruder',
    }, { role: 'host', participant_id: 'different-host' })).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(coordinator.resume('session:1', {})).rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('rejects every new command after terminal state while preserving idempotent retries', async () => {
    const { coordinator } = fixture();
    const created = await coordinator.create({ ruleset: { id: 'counter', version: 1 }, definitionId: 'counter-basic', participants: [{ id: 'participant:1' }] });
    const closed = await coordinator.close(created.header.session_id);
    await expect(coordinator.dispatch('session:1', { ...envelope(closed.header.revision), command_id: 'command:after-close' }, { participant_id: 'participant:1' })).rejects.toMatchObject({ code: 'session_terminal' });
    const duplicate = await coordinator.dispatch('session:1', {
      command_id: 'command:close', actor_id: 'system', expected_revision: 0, logical_time: 1, command: { type: 'session.close', reason: 'closed' },
    }, { role: 'system' });
    expect(duplicate.duplicate).toBe(true);
  });
});
