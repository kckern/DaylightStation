import { test, expect } from '@playwright/test';
import { openSearch } from './lib/search.mjs';
import { streamItem } from './lib/sseServer.mjs';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block' });

test('adding a search result and resizing keeps the original audio playing in queue order', async ({ page, baseURL }) => {
  const phone = { width: 390, height: 850 };
  const first = { id: 'plex:42', contentId: 'plex:42', title: 'Original track', format: 'audio',
    mediaType: 'audio', type: 'track', mediaUrl: '/fixture-audio.wav', duration: 30 };
  const second = streamItem({ id: 'plex:43', title: 'Queued track', type: 'track' });
  await page.setViewportSize(phone);
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (url.pathname === '/fixture-audio.wav') {
      return route.fulfill({ body: silentWave(30), contentType: 'audio/wav' });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/search/stream')) {
      const frames = [{ event: 'results', source: 'plex', items: [second], pending: [] }, { event: 'complete' }];
      return route.fulfill({ contentType: 'text/event-stream', body: frames.map(f => 'data: ' + JSON.stringify(f) + '\n\n').join('') });
    }
    if (decodeURIComponent(url.pathname).endsWith('/play/plex:42')) return route.fulfill({ json: first });
    if (url.pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?play=plex:42');
  const audio = page.locator('audio[src*="fixture-audio"]');
  await expect.poll(() => audio.evaluate(el => el.currentTime)).toBeGreaterThan(0);
  const original = await audio.elementHandle();
  const initialTime = await original.evaluate(el => el.currentTime);
  const input = await openSearch(page, phone);
  await input.fill('Queued track');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByText('Add to Queue', { exact: true }).click();
  await expect.poll(() => original.evaluate(el => el.isConnected && !el.paused ? el.currentTime : -1))
    .toBeGreaterThan(initialTime);
  await page.setViewportSize({ width: 850, height: 390 });
  await page.getByTestId('search-mode-close').click();
  await page.getByTestId('mini-player-open-nowplaying').click();

  const entries = page.getByTestId('queue-panel').getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText(/Original track|plex:42/);
  await expect(entries.nth(1)).toContainText('Queued track');
  await expect(page.getByTestId('now-playing-title')).toContainText('Original track');
  const timeOnReturn = await original.evaluate(el => el.currentTime);
  await expect.poll(() => original.evaluate(el => el.isConnected && !el.paused ? el.currentTime : -1))
    .toBeGreaterThan(timeOnReturn);
});
