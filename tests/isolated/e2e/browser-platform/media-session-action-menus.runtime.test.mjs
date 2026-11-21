import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const sessionPath = '/api/v1/device/den/session/';
const item = { queueItemId: 'q1', contentId: 'plex:42', title: 'Den feature', format: 'dash_video', duration: 60 };
const options = [
  { name: 'sleep timer', trigger: 'sleep-timer-button', choice: 'sleep-option-30',
    path: 'sleep-timer', parameters: { minutes: 30 }, before: 'Sleep at end of this item', after: /^Sleep in / },
  { name: 'audio tracks', trigger: 'pf-audio', choice: 'pf-audio-fra',
    path: 'tracks', parameters: { audio: 'fra' }, before: 'Audio: English', after: 'Audio: French' },
  { name: 'subtitles', trigger: 'pf-subtitles', choice: 'pf-subtitle-off',
    path: 'tracks', parameters: { subtitle: 'off' }, before: 'Subtitles: English', after: 'Subtitles: Off' },
];

for (const { name, trigger, choice, path, parameters, before, after } of options) {
  test(`Media Peek dismisses ${name} without a command and updates only after selection`, async ({ page }) => {
    let socket;
    const commands = [];
    const controls = {
      sleepTimer: { mode: 'atEnd' },
      tracks: {
        contentId: item.contentId,
        audio: [{ id: 'eng', label: 'English' }, { id: 'fra', label: 'French' }],
        subtitles: [{ id: 'eng', label: 'English' }],
        selected: { audio: 'eng', subtitle: 'eng' },
      },
    };
    const publish = (position, sessionControls = controls) => socket.send(JSON.stringify({
      topic: 'device-state:den', deviceId: 'den', ts: new Date().toISOString(),
      snapshot: {
        sessionId: 'den', state: 'playing', position, duration: item.duration, currentItem: item,
        queue: { items: [item], currentIndex: 0 },
        meta: { playbackOwner: { ownerInstanceId: 'den', playbackRevision: 1 } },
        controls: sessionControls,
      },
    }));
    await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
    await page.routeWebSocket('**/ws', connection => { socket = connection; });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.endsWith('/device/config')) {
        return route.fulfill({ json: { devices: { den: { name: 'Den TV', fleet: true } } } });
      }
      if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (request.method() === 'POST' && pathname.startsWith(sessionPath)) {
        const { commandId, origin, ...value } = request.postDataJSON();
        commands.push({ command: pathname.slice(sessionPath.length), parameters: value });
        await route.fulfill({ json: { ok: true } });
        if (pathname === sessionPath + 'sleep-timer') {
          controls.sleepTimer = { mode: 'minutes', endsAt: new Date(Date.now() + value.minutes * 60000).toISOString() };
        } else if (pathname === sessionPath + 'tracks') {
          if ('audio' in value) controls.tracks.selected.audio = value.audio;
          if ('subtitle' in value) controls.tracks.selected.subtitle = value.subtitle === 'off' ? null : value.subtitle;
        }
        socket.send(JSON.stringify({ topic: 'device-ack:den', deviceId: 'den', commandId, ok: true }));
        publish(20);
        return;
      }
      return route.fulfill({ json: {} });
    });

    await page.goto('/media');
    await page.getByTestId('app-tab-fleet').click();
    const device = page.getByTestId('fleet-peek-den');
    await expect(device).toBeVisible();
    await expect.poll(() => Boolean(socket)).toBe(true);
    publish(12);
    await device.click();
    await expect(page).toHaveURL(/view=peek.*deviceId=den/);
    const panel = page.getByTestId('peek-panel');
    const opener = panel.getByTestId(trigger);
    const menu = page.getByRole('menu');
    const peekUrl = page.url();
    await expect(opener).toHaveText(before);

    await opener.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(peekUrl);
    await expect(opener).toBeFocused();
    await expect(opener).toHaveText(before);
    expect(commands).toEqual([]);

    if (path === 'sleep-timer') {
      await opener.press('Enter');
      await expect(menu).toBeVisible();
      publish(16, null);
      await expect(opener).toBeDisabled();
      await expect(menu).toBeHidden();
      publish(18);
      await expect(opener).toBeEnabled();
      await expect(menu).toBeHidden();
      expect(commands).toEqual([]);
    }

    await opener.press('Enter');
    await menu.getByTestId(choice).click();
    await expect.poll(() => commands).toEqual([{ command: path, parameters }]);
    await expect(opener).toHaveText(after);
    const seek = panel.getByRole('slider', { name: 'Seek' });
    await expect.poll(async () => Number(await seek.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(20);
    await expect(panel).toContainText(item.title);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/view=fleet/);
  });
}
