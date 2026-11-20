import { describe, expect, it, vi } from 'vitest';
import { getRecoveryLedger, recoverySessionKey } from '../../../../../__capabilities/playback/browser/contracts.mjs';
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

it('retains owner visit and incident accounting on quality adoption and starts a fresh repeat-one visit', async () => {
  const controller = createLocalSessionController({ clientId: 'identity' });
  await controller.queue.playNow({ contentId: 'plex:42', format: 'video' });
  const identity = controller.recoveryIdentity;
  const before = identity.getTarget();
  const ledger = getRecoveryLedger();
  const visitKey = recoverySessionKey(before);
  expect(ledger.reserveAction({ sessionKey: visitKey, actor: 'test', reason: 'stall' }).allowed).toBe(true);
  const queueItemId = controller.getSnapshot().queue.items[0].queueItemId;
  expect(await controller.quality.setOverrides({ contentId: 'plex:42', quality: { maxResolution: '480' } })).toMatchObject({ ok: true });
  const afterQuality = identity.getTarget();
  expect(afterQuality.visitId).toBe(before.visitId);
  expect(afterQuality.rendererGeneration).toBeGreaterThan(before.rendererGeneration);
  controller.transport.pause();
  expect(identity.getTarget().intentRevision).toBe(afterQuality.intentRevision + 1);
  expect(ledger.snapshot(visitKey)).toMatchObject({ count: 1 });
  controller.config.setRepeat('one');
  controller.onPlayerEnded('plex:42');
  expect(ledger.snapshot(visitKey)).toBeNull();
  expect(controller.getSnapshot().queue.items[0].queueItemId).toBe(queueItemId);
  expect(identity.getTarget().visitId).not.toBe(before.visitId);
});

it('rejects quality adoption after the renderer claim was superseded', async () => {
  const controller = createLocalSessionController({ clientId: 'quality-cas' });
  await controller.queue.playNow({ contentId: 'plex:42', format: 'video' });
  const before = controller.recoveryIdentity.getTarget();
  controller.transport.pause();
  expect(controller.quality.setOverrides({ contentId: 'plex:42', reason: 'recovery-quality', target: before, quality: { maxResolution: '480' } }))
    .toMatchObject({ ok: false, code: 'PLAYBACK_CHANGED' });
  expect(controller.getSnapshot().currentItem.maxResolution).toBeUndefined();
});


it.each([
  [{ expectedEndSeconds: 5895, provenance: 'catalog', rendererStartSeconds: 0, contentStartSeconds: 4320 }, 4370],
  [{ expectedEndSeconds: 5895, provenance: 'catalog' }, 4320],
])('captures and adopts quality at confirmed content position, respecting mapping %j', async (contentTimeline, expected) => {
  const controller = createLocalSessionController({ clientId: 'timeline-quality' });
  await controller.queue.playNow({ contentId: 'plex:42', format: 'video', contentTimeline });
  controller.onPlayerPositionTick(4320);
  const node = { currentTime: 50, duration: 1575, paused: false };
  controller.setPlayerHandle({ getMediaElement: () => node, getMountedContentId: () => 'plex:42', getMountedMediaGeneration: () => 1 });
  expect(controller.portability.capture().snapshot.position).toBe(expected);
  expect(controller.quality.setOverrides({ contentId: 'plex:42', quality: { maxResolution: '480' } })).toMatchObject({ ok: true });
  expect(controller.getSnapshot().position).toBe(expected);
});

it('does not write a durable owner transition for every tick of the same immutable timeline', async () => {
  const controller = createLocalSessionController({ clientId: 'timeline-observation' });
  await controller.queue.playNow({ contentId: 'plex:42', format: 'video' });
  const contentTimeline = Object.freeze({ expectedEndSeconds: 5895, provenance: 'catalog', rendererStartSeconds: 0, contentStartSeconds: 0 });
  const observation = { media: { contentTimeline }, duration: 5895 };
  controller.onPlayerObservation('plex:42', observation);
  const before = controller.getSnapshot();
  controller.onPlayerObservation('plex:42', observation);
  expect(controller.getSnapshot()).toBe(before);
});
