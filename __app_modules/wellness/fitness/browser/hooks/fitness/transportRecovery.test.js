import { describe, it, expect, vi } from 'vitest';
import { createTransportRecovery } from './transportRecovery.js';

const health = (seq, extra = {}) => ({ protocol: 1, bootId: 'a', sourceSeq: seq, receivedCount: seq, sentCount: seq, lastSourceAgeMs: 0, socketPhase: 'open', ...extra });
function setup() {
  let time = 0;
  const refreshSubscription = vi.fn();
  const cancel = vi.fn();
  const reconnect = vi.fn(() => cancel);
  const onIncident = vi.fn();
  const onEscalate = vi.fn();
  const recovery = createTransportRecovery({ now: () => time, refreshSubscription, reconnect, onIncident, onEscalate });
  const tick = (at, opts = {}) => { time = at; return recovery.tick({ active: true, stopped: false, ...opts }); };
  recovery.observeSample({ bootId: 'a', seq: 1 });
  tick(0);
  return { recovery, tick, refreshSubscription, reconnect, cancel, onIncident, onEscalate };
}

describe('fitness browser transport recovery', () => {
  it('refreshes at 15000 ms and reconnects once at 30000 ms for a lost active path', () => {
    const { recovery, tick, refreshSubscription, reconnect } = setup();
    tick(14999);
    expect(refreshSubscription).not.toHaveBeenCalled();
    recovery.observeHealth(health(20));
    expect(tick(15000).state).toBe('recovering');
    tick(29999);
    expect(reconnect).not.toHaveBeenCalled();
    tick(30000); tick(60000); tick(180000);
    expect(refreshSubscription).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('one absent strap or a quiet inactive room does not reconnect', () => {
    const { recovery, tick, reconnect } = setup();
    for (let at = 1000; at <= 40000; at += 1000) {
      tick(at); recovery.observeSample({ bootId: 'a', seq: at });
    }
    tick(90000, { active: false });
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('a fresh quiet receiver is distinct from progressing source with missing browser delivery', () => {
    const { recovery, tick, reconnect, refreshSubscription } = setup();
    for (const at of [10000, 15000, 30000]) {
      tick(at - 1, { active: false });
      recovery.observeHealth(health(1, { lastSourceAgeMs: at }));
      expect(tick(at).state).toBe('quiet');
    }
    expect(refreshSubscription).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('missing health cannot override fresh samples and diagnostics cannot recover an incident', () => {
    const { recovery, tick, onIncident } = setup();
    expect(tick(1000).state).toBe('healthy');
    tick(15000);
    recovery.observeHealth(health(30));
    expect(tick(16000).state).toBe('recovering');
    expect(onIncident.mock.calls.map(([e]) => e.type)).toEqual(['stalled']);
    recovery.observeSample({ bootId: 'a', seq: 30 });
    expect(tick(16000).state).toBe('healthy');
    expect(onIncident.mock.calls.map(([e]) => e.type)).toEqual(['stalled', 'recovered']);
    expect(onIncident.mock.calls[0][0].incidentId).toBe(onIncident.mock.calls[1][0].incidentId);
  });

  it('bridge reboot fences old sequences and duplicate reconnect owners', () => {
    const { recovery, tick, reconnect } = setup();
    recovery.observeHealth(health(0, { bootId: 'b', lastSourceAgeMs: null }));
    const oldGenerationAccepted = recovery.observeSample({ bootId: 'a', seq: 100 });
    expect(oldGenerationAccepted).toBe(false);
    expect(recovery.observeSample({ bootId: 'b', seq: 1 })).toBe(true);
    expect(recovery.observeSample({ bootId: 'b', seq: 1 })).toBe(false);
    tick(15000); tick(30000); tick(31000);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('bounds attempts across incidents and escalates persistent loss once with metadata only', () => {
    const { recovery, tick, reconnect, refreshSubscription, onEscalate } = setup();
    tick(15000); tick(30000); tick(60000); tick(90000);
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate.mock.calls[0][0]).toMatchObject({ type: 'lost', state: 'lost', bootId: 'a' });
    recovery.observeSample({ bootId: 'a', seq: 2 });
    tick(105000); tick(120000);
    expect(refreshSubscription).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('Stop and route disposal cancel pending recovery without resume or delayed work', () => {
    const { recovery, tick, cancel, reconnect } = setup();
    tick(15000); tick(30000);
    expect(tick(30001, { stopped: true }).state).toBe('quiet');
    expect(cancel).toHaveBeenCalledTimes(1);
    tick(60000, { stopped: true });
    recovery.dispose(); tick(180000);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
  it('does not count an inactive interval toward a new active recovery deadline', () => {
    const { recovery, tick, refreshSubscription } = setup();
    tick(1000, { active: false });
    tick(90000);
    expect(refreshSubscription).not.toHaveBeenCalled();
    tick(105000);
    expect(refreshSubscription).toHaveBeenCalledTimes(1);
    recovery.dispose();
  });

  it('Stop releases a manual recovery request through the same owner', () => {
    const { recovery, tick, cancel } = setup();
    recovery.requestReconnect();
    tick(1, { stopped: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

});
