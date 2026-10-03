import { describe, it, expect, vi } from 'vitest';
import { RoutineLoadRecorder } from './RoutineLoadRecorder.mjs';
import { LoadOriginHints } from './LoadOriginHints.mjs';
import { RoutineTriggerDedupeService } from '#apps/devices/services/RoutineTriggerDedupeService.mjs';

function build({ ctx = null, match = null, result = { ok: true, dispatchId: 'd1' }, now = () => 1_000 } = {}) {
  const wakeAndLoad = { execute: vi.fn(async () => result) };
  const history = { record: vi.fn(async (run) => run) };
  const hints = new LoadOriginHints();
  const catalog = { peekMatch: vi.fn(() => match) };
  const recorder = new RoutineLoadRecorder({
    wakeAndLoad, context: () => ctx, catalog, history, hints,
    dedupe: new RoutineTriggerDedupeService({ clock: { now } }),
    clock: { now }, logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { recorder, wakeAndLoad, history, hints, catalog };
}

describe('RoutineLoadRecorder', () => {
  it('a Home Assistant load is a routine named from the catalog; history records the outcome; the screen\'s next start gets the origin', async () => {
    const { recorder, wakeAndLoad, history, hints, catalog } = build({
      ctx: { userAgent: 'HomeAssistant/2026.9.1 aiohttp/3.10.5 Python/3.13' },
      match: { id: 'automation:kitchen_button_4', name: 'Kitchen Button 4: Slow TV' },
    });
    const query = { queue: 'slow-tv', shader: 'minimal', volume: 10, shuffle: '1' };
    const result = await recorder.execute('livingroom-tv', query, { dispatchId: 'd1' });
    expect(result).toEqual({ ok: true, dispatchId: 'd1' });
    // The routine's name rides on to the screen's command envelope.
    expect(wakeAndLoad.execute).toHaveBeenCalledWith('livingroom-tv', query, {
      dispatchId: 'd1',
      origin: { kind: 'routine', id: 'automation:kitchen_button_4', name: 'Kitchen Button 4: Slow TV', triggerId: 'automation:kitchen_button_4' },
    });
    expect(catalog.peekMatch).toHaveBeenCalledWith('livingroom-tv', query);
    expect(history.record).toHaveBeenCalledWith({
      routine: { kind: 'routine', id: 'automation:kitchen_button_4', name: 'Kitchen Button 4: Slow TV' },
      deviceId: 'fleet:livingroom-tv', query, result, error: null,
    });
    expect(hints.take('fleet:livingroom-tv', 2_000)).toEqual({ kind: 'routine', id: 'automation:kitchen_button_4', name: 'Kitchen Button 4: Slow TV' });
  });

  it('an unrecognised Home Assistant load is still a routine, named "Home Assistant"', async () => {
    const { recorder, history } = build({ ctx: { userAgent: 'HomeAssistant/2026.9' } });
    await recorder.execute('office-tv', { queue: 'x' });
    expect(history.record.mock.calls[0][0].routine).toEqual({ kind: 'routine', id: null, name: 'Home Assistant' });
  });

  it('routine=<name> in the query names the routine and is stripped before the screen sees it', async () => {
    const { recorder, wakeAndLoad, history, catalog } = build();
    await recorder.execute('livingroom-tv', { queue: 'morning-program', routine: 'Morning', routineId: 'automation:morning' });
    expect(wakeAndLoad.execute.mock.calls[0][1]).toEqual({ queue: 'morning-program' });
    expect(catalog.peekMatch).not.toHaveBeenCalled();
    expect(history.record.mock.calls[0][0].routine).toEqual({ kind: 'routine', id: 'automation:morning', name: 'Morning' });
  });

  it('the same routine trigger twice within 10 s starts once; the repeat is recorded as deduplicated', async () => {
    const { recorder, wakeAndLoad, history } = build({ ctx: { userAgent: 'HomeAssistant/1' }, match: { id: 'a', name: 'A' } });
    await recorder.execute('livingroom-tv', { queue: 'x' });
    const again = await recorder.execute('livingroom-tv', { queue: 'x' });
    expect(wakeAndLoad.execute).toHaveBeenCalledTimes(1);
    expect(again.deduplicated).toBe(true);
    expect(history.record).toHaveBeenCalledTimes(2);
  });

  it('a failed routine load clears the hint and records the failure; a thrown one is recorded and rethrown', async () => {
    const failing = build({ ctx: { userAgent: 'HomeAssistant/1' }, result: { ok: false, failedStep: 'power' } });
    await failing.recorder.execute('livingroom-tv', { queue: 'x' });
    expect(failing.history.record.mock.calls[0][0].result).toEqual({ ok: false, failedStep: 'power' });
    expect(failing.hints.take('fleet:livingroom-tv', 2_000)).toBeNull();

    const throwing = build({ ctx: { userAgent: 'HomeAssistant/1' } });
    throwing.wakeAndLoad.execute.mockRejectedValueOnce(new Error('boom'));
    await expect(throwing.recorder.execute('livingroom-tv', { queue: 'y' })).rejects.toThrow('boom');
    expect(throwing.history.record.mock.calls[0][0].error.message).toBe('boom');
  });

  it('a person sending from another screen: device origin for the start, no routine history', async () => {
    const { recorder, history, hints } = build({ ctx: { userAgent: 'Mozilla/5.0', device: 'browser:abc' } });
    await recorder.execute('livingroom-tv', { play: 'plex:1' }, { dispatchId: 'd' });
    expect(history.record).not.toHaveBeenCalled();
    expect(hints.take('fleet:livingroom-tv', 2_000)).toEqual({ kind: 'device', id: 'browser:abc', name: null });
  });

  it('a device origin the router already put in opts is honoured and passed through untouched', async () => {
    const { recorder, wakeAndLoad, hints } = build();
    const opts = { dispatchId: 'd', origin: { kind: 'device', id: 'fleet:office-tv' } };
    await recorder.execute('livingroom-tv', { play: 'plex:1' }, opts);
    expect(wakeAndLoad.execute).toHaveBeenCalledWith('livingroom-tv', { play: 'plex:1' }, opts);
    expect(hints.take('fleet:livingroom-tv', 2_000)).toEqual({ kind: 'device', id: 'fleet:office-tv', name: null });
  });

  it('Home Assistant never waits on the history write (registry/YAML) after the load', async () => {
    const { recorder, history, wakeAndLoad } = build({ ctx: { userAgent: 'HomeAssistant/1' } });
    history.record.mockImplementation(() => new Promise(() => {})); // never settles
    await expect(recorder.execute('livingroom-tv', { queue: 'x' })).resolves.toEqual({ ok: true, dispatchId: 'd1' });
    expect(wakeAndLoad.execute).toHaveBeenCalledTimes(1);
  });

  it('a history write failure is logged, not thrown', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const history = { record: vi.fn(async () => { throw new Error('EROFS'); }) };
    const recorder = new RoutineLoadRecorder({
      wakeAndLoad: { execute: async () => ({ ok: true }) }, context: () => ({ userAgent: 'HomeAssistant/1' }), history, logger,
    });
    await recorder.execute('livingroom-tv', { queue: 'x' });
    await new Promise((r) => setImmediate(r));
    expect(logger.warn).toHaveBeenCalledWith('media.routines.history_record_failed', expect.objectContaining({ error: 'EROFS' }));
  });

  it('an unknown caller (no context) passes straight through with no origin', async () => {
    const { recorder, history, hints, wakeAndLoad } = build();
    await recorder.execute('livingroom-tv', { play: 'plex:1' });
    expect(wakeAndLoad.execute).toHaveBeenCalledTimes(1);
    expect(history.record).not.toHaveBeenCalled();
    expect(hints.take('fleet:livingroom-tv', 2_000)).toBeNull();
  });
});
