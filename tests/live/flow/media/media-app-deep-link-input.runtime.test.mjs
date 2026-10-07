import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

// The search box used to pin a "Play This ID" suggestion when a source:id was
// typed. The unified selector retired it: a typed content id is just a query
// (media-search-input / search-deeplink-* no longer exist). The ordinary
// deep-link paths are `/media?play=<contentId>` (media-app-autoplay) and the
// destination-aware result verbs. What this journey still guards is that a
// pasted source:id is handled honestly: it stays in the box, the search
// settles to a stated outcome, and it never starts playback by itself.
test.describe('MediaApp — deep-link content-ID input', () => {
  test('typing source:id keeps the text, settles to a stated outcome and starts nothing', async ({ page, context }) => {
    await markFirstUseDone(context);
    await page.addInitScript(() => { try { localStorage.removeItem('media-app.session'); } catch {} });
    await page.goto('/media');
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('plex:12345');
    await expect(search).toHaveValue('plex:12345');
    // Settled: matching options (a source-scoped text search), the explicit empty
    // line, or the named source that did not answer — never a spinner forever.
    // (An id with an unknown source prefix, such as plex-main:12345, can sit on
    // "Searching…" for longer than this journey waits, so it is not used here.)
    await expect(page.getByRole('listbox')).toContainText(/No results|did not answer|Plex/i, { timeout: 45000 });
    // Typing an id never plays by itself.
    await expect(page.getByTestId('media-mini-player')).toHaveCount(0);
  });
});
