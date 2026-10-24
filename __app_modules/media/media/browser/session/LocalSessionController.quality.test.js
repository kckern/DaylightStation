import { describe, expect, it, vi } from 'vitest';
import { createLocalSessionController } from './LocalSessionController.js';

vi.mock('../logging/mediaLog.js', () => ({ default: new Proxy({}, { get: () => () => {} }) }));

describe('local playback quality overrides', () => {
  it('survives queue insertion, current-item projection and active changes at the hot position', async () => {
    const controller = createLocalSessionController({ clientId: 'local' });
    await controller.queue.playNow({ contentId: 'plex:42', format: 'video', maxResolution: '720', maxVideoBitrate: 4000, adaptive: false });
    expect(controller.getSnapshot().currentItem).toMatchObject({ maxResolution: '720', maxVideoBitrate: 4000, adaptive: false });
    controller.onPlayerPositionTick(4320.75);
    controller.store.dispatch({ type: 'PLAYER_STATE', playerState: 'paused' });
    controller.config.setVolume(33);
    const before = controller.getSnapshot();
    const result = await controller.quality.setOverrides({ contentId: 'plex:42', quality: { maxResolution: '480', transcode: 'force', adaptive: false } });
    expect(result).toMatchObject({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({ position: 4320.75, state: 'paused',
      currentItem: { contentId: 'plex:42', maxResolution: '480', transcode: 'force', adaptive: false },
      config: { volume: 33 } });
    expect(controller.getSnapshot().currentItem).not.toHaveProperty('maxVideoBitrate');
    expect(controller.getSnapshot().queue.items[0].queueItemId).toBe(before.queue.items[0].queueItemId);
  });
  it('refuses a change after the intended item has changed', async () => {
    const controller = createLocalSessionController({ clientId: 'local' });
    await controller.queue.playNow({ contentId: 'plex:43', format: 'video' });
    expect(await controller.quality.setOverrides({ contentId: 'plex:42', quality: { maxResolution: '480' } }))
      .toMatchObject({ ok: false, code: 'PLAYBACK_CHANGED' });
    expect(controller.getSnapshot().currentItem.contentId).toBe('plex:43');
  });
});


it.each(['skip', 'end'])('keeps shuffled advancement after a quality change (%s)', async kind => {
  const c = createLocalSessionController({ clientId: 'shuffle-quality' });
  await c.queue.playNow({ contentId: 'plex:1', format: 'video' });
  await c.queue.add({ contentId: 'plex:2', format: 'video' });
  await c.queue.add({ contentId: 'plex:3', format: 'video' });
  c.config.setShuffle(true);
  expect(c.getSnapshot().queue).not.toHaveProperty('executionOrder');
  expect(await c.quality.setOverrides({ contentId: 'plex:1', quality: { maxResolution: '720' } })).toMatchObject({ ok: true });
  expect(c.getSnapshot().queue).not.toHaveProperty('executionOrder');
  if (kind === 'skip') c.transport.skipNext(); else c.onPlayerEnded('plex:1');
  expect(['plex:2', 'plex:3']).toContain(c.getSnapshot().currentItem?.contentId);
});
