import { describe, expect, it, vi } from 'vitest';
import { RoutineTriggerDedupeService } from './RoutineTriggerDedupeService.mjs';

describe('RoutineTriggerDedupeService', () => {
  it('suppresses one repeated routine trigger per target for ten seconds', async () => {
    let now = 1000;
    const service = new RoutineTriggerDedupeService({ clock: { now: () => now } });
    const execute = vi.fn(async () => ({ ok: true }));
    const trigger = { triggerId: 'morning-1', targetId: 'kitchen', kind: 'play', content: 'plex:1', origin: { kind: 'routine', name: 'Morning' } };

    await expect(service.run(trigger, execute)).resolves.toEqual({ ok: true });
    now += 9_999;
    await expect(service.run(trigger, execute)).resolves.toMatchObject({ ok: true, deduplicated: true });
    expect(execute).toHaveBeenCalledTimes(1);
    now += 2;
    await service.run(trigger, execute);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('uses content, target and kind when triggerId is absent and never suppresses later human action', async () => {
    const service = new RoutineTriggerDedupeService({ clock: { now: () => 1000 } });
    const routine = vi.fn(async () => ({ ok: true, source: 'routine' }));
    const human = vi.fn(async () => ({ ok: true, source: 'human' }));
    const input = { targetId: 'kitchen', kind: 'play', content: { contentId: 'plex:1' }, origin: { kind: 'routine', name: 'Morning' } };

    await service.run(input, routine);
    await service.run(input, routine);
    await service.run({ ...input, origin: { kind: 'device', id: 'browser:human' } }, human);

    expect(routine).toHaveBeenCalledTimes(1);
    expect(human).toHaveBeenCalledTimes(1);
  });

  it('does not poison the dedupe window when execution fails', async () => {
    const service = new RoutineTriggerDedupeService({ clock: { now: () => 1000 } });
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true });
    const input = { triggerId: 'morning-1', targetId: 'kitchen', kind: 'play', origin: { kind: 'routine', name: 'Morning' } };

    await expect(service.run(input, execute)).resolves.toMatchObject({ ok: false });
    await expect(service.run(input, execute)).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight successful result between concurrent duplicates', async () => {
    let resolveExecution;
    const service = new RoutineTriggerDedupeService({ clock: { now: () => 1000 } });
    const execute = vi.fn(() => new Promise(resolve => { resolveExecution = resolve; }));
    const input = { triggerId: 'morning-1', targetId: 'kitchen', kind: 'play', origin: { kind: 'routine', name: 'Morning' } };

    const first = service.run(input, execute);
    const duplicate = service.run(input, execute);
    await Promise.resolve();
    resolveExecution({ ok: true, applied: 1 });

    await expect(first).resolves.toEqual({ ok: true, applied: 1 });
    await expect(duplicate).resolves.toEqual({ ok: true, applied: 1, deduplicated: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
