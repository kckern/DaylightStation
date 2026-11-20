import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

const item = { id: 'plex:42', contentId: 'plex:42', title: 'Remote track',
  format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-move.wav', duration: 60 };
const audio = silentWave(60);

for (const { entry, accepted } of [
  { entry: 'Fleet', accepted: true },
  { entry: 'Fleet', accepted: false },
  { entry: 'Remote', accepted: true },
]) {
  test(`${entry} moves to this device after native playback and resolves a ${accepted ? 'confirmed' : 'refused'} source stop`, async ({ page, baseURL }) => {
    let socket;
    let audioRequested = false;
    const releaseAudio = Promise.withResolvers();
    const releaseStop = Promise.withResolvers();
    const stops = [];
    await page.addInitScript(() => {
      localStorage.setItem('media-app.first-use-done', 'done');
      window.fixturePlaying = false;
      document.addEventListener('playing', ({ target }) => {
        if (target instanceof HTMLAudioElement && target.currentSrc.includes('fixture-move.wav')) window.fixturePlaying = true;
      }, true);
    });
    await page.routeWebSocket('**/*', connection => { socket = connection; });
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
      ? route.continue() : route.abort());
    await page.route('**/fixture-move.wav', async route => {
      audioRequested = true;
      await releaseAudio.promise;
      return route.fulfill({ contentType: 'audio/wav', body: audio });
    });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = decodeURIComponent(new URL(request.url()).pathname);
      if (path.endsWith('/device/config')) {
        return route.fulfill({ json: { devices: { fixture: { name: 'Fixture screen', fleet: true } } } });
      }
      if (path.endsWith('/play/plex:42')) return route.fulfill({ json: item });
      if (path.endsWith('/device/fixture/session/transport') || path.endsWith('/device/fixture/session/claim')) {
        const body = request.postDataJSON();
        const evidence = await page.evaluate(() => {
          const node = Array.from(document.querySelectorAll('audio')).find(audio => audio.currentSrc.includes('fixture-move.wav'));
          return Boolean(window.fixturePlaying && node && !node.paused && node.readyState >= 2 && node.currentTime > 0);
        });
        stops.push({ body, evidence, endpoint: path.split('/').at(-1) });
        if (entry === 'Remote') {
          await releaseStop.promise;
          return route.fulfill({ json: { ok: true, commandId: body.commandId } });
        }
        await route.fulfill({ json: { ok: true } });
        await releaseStop.promise;
        socket.send(JSON.stringify({ topic: 'device-ack:fixture', deviceId: 'fixture', commandId: body.commandId,
          ok: accepted, ...(accepted ? {} : { code: 'FIXTURE_UNAVAILABLE' }) }));
        return;
      }
      return route.fulfill({ json: path.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    });

    try {
      await page.goto('/media?view=fleet');
      const peek = page.getByTestId('fleet-peek-fixture');
      await expect(peek).toBeVisible();
      await expect.poll(() => Boolean(socket)).toBe(true);
      const updatedAt = new Date().toISOString();
      socket.send(JSON.stringify({ topic: 'device-state:fixture', deviceId: 'fixture', ts: updatedAt,
        snapshot: { sessionId: 'remote-session', state: 'playing', currentItem: item, position: 0, duration: 60,
          queue: { items: [{ ...item, queueItemId: 'remote-entry' }], currentIndex: 0, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off' },
          meta: { ownerId: 'fixture', updatedAt, playbackOwner: { ownerInstanceId: 'owner-1', playbackRevision: 3,
            queueRevision: 1, sessionId: 'remote-session', contentId: item.contentId, queueItemId: 'remote-entry' } },
        } }));
      const move = page.getByTestId('fleet-takeover-fixture');
      await expect(move).toBeEnabled();
      if (entry === 'Fleet') await move.click();
      else {
        await peek.click();
        await page.getByTestId('peek-move-to').click();
        await page.getByTestId('move-to-local').click();
      }
      await expect.poll(() => audioRequested).toBe(true);
      expect(stops).toEqual([]);
      releaseAudio.resolve();
      await expect.poll(() => stops).toEqual([expect.objectContaining({
        body: expect.objectContaining({ commandId: expect.any(String), ...(entry === 'Fleet' ? { action: 'stop' } : {}) }),
        endpoint: entry === 'Fleet' ? 'transport' : 'claim', evidence: true,
      })]);
      const announced = page.getByTestId('media-outcome-announcer');
      await expect(announced).toContainText('Moving Remote track');
      releaseStop.resolve();
      if (accepted) {
        await expect(announced).toHaveText('Moved Remote track here from Fixture screen');
        if (entry === 'Remote') await expect(page.getByTestId('now-playing-view')).toBeVisible();
      } else {
        await expect(announced).toContainText('Could not confirm the other screen stopped.');
        await expect(announced).toContainText('Remote track');
      }
    } finally {
      releaseAudio.resolve();
      releaseStop.resolve();
    }
  });
}
