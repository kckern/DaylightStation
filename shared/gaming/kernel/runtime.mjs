import { assertValid, validateCommandEnvelope, validateEventEnvelope } from './contracts.mjs';
import { canonicalStringify, stableHash } from './canonical.mjs';
import { IdempotencyConflictError, RevisionConflictError, GamingKernelError } from './errors.mjs';

const clone = (value) => structuredClone(value);

export class GameRuntime {
  constructor({ rulesets = [] } = {}) {
    this.rulesets = new Map(rulesets.map((ruleset) => [`${ruleset.id}@${ruleset.version}`, ruleset]));
  }

  getRuleModule(reference) {
    const ruleset = this.rulesets.get(`${reference.id}@${reference.version}`);
    if (!ruleset) throw new GamingKernelError('ruleset_unavailable', `Ruleset ${reference.id}@${reference.version} is unavailable`);
    return ruleset;
  }

  create({ header, definition, setup = {} }) {
    const ruleset = this.getRuleModule(header.ruleset);
    const validation = ruleset.validateDefinition(definition);
    if (!validation.valid) throw new GamingKernelError('invalid_definition', validation.errors.join('; '), validation.errors);
    return {
      header: clone(header),
      state: ruleset.createInitialState(definition, { seed: header.seed, participants: header.participants, seats: header.seats, setup: clone(setup) }),
      accepted_commands: {},
    };
  }

  dispatch(session, envelope, definition, { recordedAt }) {
    assertValid(validateCommandEnvelope(envelope), 'CommandEnvelope');
    const fingerprint = stableHash(envelope);
    const prior = session.accepted_commands?.[envelope.command_id];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new IdempotencyConflictError(envelope.command_id);
      return { session: clone(session), events: clone(prior.events), duplicate: true };
    }
    if (envelope.expected_revision !== session.header.revision) throw new RevisionConflictError(envelope.expected_revision, session.header.revision);
    const terminal = ['complete', 'abandoned'].includes(session.header.status);
    if (terminal) throw new GamingKernelError('session_terminal', `Session ${session.header.session_id} is ${session.header.status}`);
    const ruleset = this.getRuleModule(session.header.ruleset);
    const result = envelope.command.type === 'session.close'
      ? { state: { ...clone(session.state), status: 'complete' }, status: 'complete', events: [{ type: 'session.closed', reason: envelope.command.reason || 'closed' }] }
      : ruleset.handleCommand(clone(session.state), clone(envelope.command), definition, {
      actorId: envelope.actor_id,
      commandId: envelope.command_id,
      logicalTime: envelope.logical_time,
      seed: session.header.seed,
      revision: session.header.revision,
      });
    if (!result || result.error) throw new GamingKernelError(result?.error?.code || 'rule_rejected', result?.error?.message || 'Ruleset rejected command', result?.error?.details);
    const revision = session.header.revision + 1;
    const correlationId = envelope.correlation_id || envelope.command_id;
    const events = (result.events || []).map((event, index) => ({
      event_id: `evt:${revision}:${index}:${stableHash(event)}`,
      revision,
      causation_id: envelope.command_id,
      correlation_id: correlationId,
      recorded_at: recordedAt,
      event: clone(event),
    }));
    events.forEach((event) => assertValid(validateEventEnvelope(event), 'EventEnvelope'));
    const next = clone(session);
    next.header.revision = revision;
    next.header.status = result.status || result.state?.status || next.header.status;
    next.state = clone(result.state);
    next.accepted_commands = {
      ...(next.accepted_commands || {}),
      [envelope.command_id]: { fingerprint, events: clone(events) },
    };
    return { session: next, events, duplicate: false, fingerprint: canonicalStringify(envelope) };
  }

  project(session, definition, viewer = {}) {
    return this.getRuleModule(session.header.ruleset).project(clone(session.state), definition, viewer);
  }
}
