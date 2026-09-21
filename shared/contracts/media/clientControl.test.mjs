import { describe, expect, it } from 'vitest';
import { validateClientAck, validateClientControlMessage } from './clientControl.mjs';

const command = {
  topic: 'client-control:target-live',
  replyToControlClientId: 'caller-live',
  commandId: 'cmd-1',
  command: 'transport',
  params: { action: 'pause' },
};

describe('browser client-control contracts', () => {
  it('accepts only a routed, valid existing command envelope', () => {
    expect(validateClientControlMessage(command)).toEqual({ valid: true, errors: [] });
  });

  it('rejects an empty target route or a missing reply route', () => {
    expect(validateClientControlMessage({ ...command, topic: 'client-control:' }).valid).toBe(false);
    expect(validateClientControlMessage({ ...command, replyToControlClientId: '' }).valid).toBe(false);
  });

  it('accepts scalar terminal ack fields but refuses arbitrary proof objects', () => {
    expect(validateClientAck({
      topic: 'client-ack', clientId: 'target-live', replyToControlClientId: 'caller-live',
      commandId: 'cmd-1', ok: false, error: 'unavailable', code: 'UNAVAILABLE', appliedAt: '2026-09-14T00:00:00.000Z',
    })).toEqual({ valid: true, errors: [] });
    expect(validateClientAck({
      topic: 'client-ack', clientId: 'target-live', replyToControlClientId: 'caller-live',
      commandId: 'cmd-1', ok: true, proof: { started: true },
    }).valid).toBe(false);
  });

  it('requires a boolean ack result and the receiver identity', () => {
    expect(validateClientAck({ topic: 'client-ack', clientId: 'target-live', replyToControlClientId: 'caller-live', commandId: 'cmd-1' }).valid).toBe(false);
    expect(validateClientAck({ topic: 'client-ack', replyToControlClientId: 'caller-live', commandId: 'cmd-1', ok: true }).valid).toBe(false);
  });

  it('allows only a validated typed handoff result as an additive ack projection', () => {
    const base = {
      topic: 'client-ack', clientId: 'target-live', replyToControlClientId: 'caller-live',
      commandId: 'cmd-handoff', ok: false,
      handoff: { transferId: 'transfer-1', phase: 'failed', code: 'HANDOFF_UNSUPPORTED' },
    };
    expect(validateClientAck(base).valid).toBe(true);
    expect(validateClientAck({ ...base, handoff: { transferId: 'transfer-1', phase: 'started' } }).valid).toBe(false);
  });
});
