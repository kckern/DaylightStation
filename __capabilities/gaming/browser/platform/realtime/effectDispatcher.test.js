import { describe, it, expect, vi } from 'vitest';
import { createEffectDispatcher } from "./effectDispatcher.js";

const names = {
  event: (e) => `flight.${e.type}`,
  executed: 'executed', skipped: 'skipped', failed: 'failed',
};
const mkLog = () => ({ info: vi.fn(), error: vi.fn() });

describe('createEffectDispatcher', () => {
  it('logs event then each effect in order, and plays the cue', () => {
    const log = mkLog();
    const calls = [];
    log.info.mockImplementation((n, d) => calls.push([n, d]));
    const visual = vi.fn();
    const playCue = vi.fn(() => true);
    const d = createEffectDispatcher({
      table: { collision: () => [{ id: 'burst', visual }, { id: 'cue', cue: 'crash' }] },
      playCue, log, logNames: names, correlation: () => ({ runId: 'r' }),
    });
    d.dispatch([{ type: 'collision', data: { kind: 'crash' } }], { courseTime: 3 });
    expect(calls).toEqual([
      ['flight.collision', { runId: 'r', courseTime: 3, kind: 'crash' }],
      ['executed', { runId: 'r', courseTime: 3, eventType: 'collision', effectId: 'burst' }],
      ['executed', { runId: 'r', courseTime: 3, eventType: 'collision', effectId: 'cue' }],
    ]);
    expect(visual).toHaveBeenCalled();
    expect(playCue).toHaveBeenCalledWith('crash');
  });

  it('logs skipped with the reason when the cue does not play', () => {
    const log = mkLog();
    const d = createEffectDispatcher({
      table: { x: () => [{ id: 'c', cue: 'k' }] }, playCue: () => false, log,
      logNames: names, skippedReason: () => 'muted',
    });
    d.dispatch([{ type: 'x', data: {} }]);
    expect(log.info).toHaveBeenLastCalledWith('skipped', { eventType: 'x', effectId: 'c', reason: 'muted' });
  });

  it('a throwing visual is logged failed and the next cue still plays', () => {
    const log = mkLog();
    const playCue = vi.fn(() => true);
    const d = createEffectDispatcher({
      table: { x: () => [{ id: 'v', visual: () => { throw new Error('boom'); } }, { id: 'c', cue: 'k' }] },
      playCue, log, logNames: names,
    });
    d.dispatch([{ type: 'x', data: {} }]);
    expect(log.error).toHaveBeenCalledWith('failed', { eventType: 'x', effectId: 'v', error: 'boom' });
    expect(playCue).toHaveBeenCalledWith('k');
  });

  it('with no names nothing is logged but the cue plays', () => {
    const log = mkLog();
    const playCue = vi.fn(() => true);
    const d = createEffectDispatcher({ table: { x: () => [{ id: 'c', cue: 'k' }] }, playCue, log, logNames: {} });
    d.dispatch([{ type: 'x', data: {} }]);
    expect(log.info).not.toHaveBeenCalled();
    expect(playCue).toHaveBeenCalledWith('k');
  });

  it('an effect with neither visual nor cue logs executed; unknown type logs only the event', () => {
    const log = mkLog();
    const d = createEffectDispatcher({
      table: { x: () => [{ id: 'ceremony' }] }, playCue: vi.fn(), log, logNames: names,
    });
    d.dispatch([{ type: 'x', data: {} }, { type: 'nope', data: {} }]);
    expect(log.info.mock.calls.map((c) => c[0])).toEqual(['flight.x', 'executed', 'flight.nope']);
  });
});
