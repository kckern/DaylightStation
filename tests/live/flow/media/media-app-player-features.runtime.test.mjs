import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getAppPort } from '../../../_lib/configHelper.mjs';

// Player features (P2) against a REAL mounted screen page and the real Media
// app, run on `tests/_lib/media-redesign-server.mjs` (BASE_URL): the one
// virtual receiver (`acceptance-media`) publishes its own state; no household
// screen is commanded, no route is intercepted, no ack is synthesized.
//
//   STEER.12a  subtitles / audio language — this device and a screen's Remote
//   PLAY.8a/8b Show briefly — a camera or clip over the programme, then back
//   PLAY.9a    music behind a slideshow, steered separately; stop asks
//
// Routine starts use the device load route with no device header (exactly
// what a Home Assistant automation sends). Every PERSON action is ordinary
// pointer input on the Media app or the screen.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const EP1 = 'plex:665638'; // 3 Body Problem S1E1 — 43 subtitle streams
const EP2 = 'plex:665639'; // S1E2 — same show, its own stream ids
const EP1_ENGLISH = '1278358';
const EP2_ENGLISH = '1278403';
const FILM = 'plex:703558'; // French original with Turkish and English audio
const FILM_FRENCH = '1376006';
const FILM_ENGLISH = '1376008';
const HOSPITAL = 'plex:266151';
const KEEPY_UPPY = 'plex:266152';
const FAITH = 'plex:584614';
const EVIDENCE = process.env.MEDIA_PLAYER_FEATURES_EVIDENCE_DIR
  || path.resolve('test-results', 'media-player-features');
fs.mkdirSync(EVIDENCE, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(EVIDENCE, `${name}.png` ) });

async function call(request, method, url, body, headers) {
  const response = await request.fetch(url, { method, data: body ? { commandId: randomUUID(), ...body } : undefined, headers });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;
const routineLoad = (request, query) => call(request, 'GET', `${base}/load?${query}&dispatchId=${randomUUID()}`);

// The household Plex keeps a per-file stream choice (as every Plex client
// does), per ACCOUNT. The journey changes it on three files. Before touching
// anything it reads each part's CURRENT selection and puts back exactly that
// in teardown — it never writes a guessed "reset" value as the final state.
const upstream = `http://127.0.0.1:${getAppPort()}`;
const PLEX_FILES = [EP1, EP2, FILM];
const baseline = new Map(); // ratingKey -> { partId, audioStreamId, subtitleStreamId }
async function readPlexSelection(request, id) {
  const meta = await request.get(`${upstream}/api/v1/proxy/plex/library/metadata/${id.split(':')[1]}`, { headers: { Accept: 'application/json' } });
  const part = (await meta.json()).MediaContainer.Metadata[0].Media[0].Part[0];
  const streams = part.Stream ?? [];
  const audio = streams.find((x) => x.streamType === 2 && x.selected);
  const subtitle = streams.find((x) => x.streamType === 3 && x.selected);
  return { partId: part.id, audioStreamId: audio ? String(audio.id) : null, subtitleStreamId: subtitle ? String(subtitle.id) : '0' };
}
async function putPlexSelection(request, partId, { audioStreamId = null, subtitleStreamId = null }) {
  const params = new URLSearchParams({ allParts: '1' });
  if (audioStreamId != null) params.set('audioStreamID', audioStreamId);
  if (subtitleStreamId != null) params.set('subtitleStreamID', subtitleStreamId);
  const put = await request.fetch(`${upstream}/api/v1/proxy/plex/library/parts/${partId}?${params}`, { method: 'PUT' });
  expect(put.status()).toBe(200);
}
async function capturePlexBaseline(request) {
  if (baseline.size) return;
  for (const id of PLEX_FILES) baseline.set(id, await readPlexSelection(request, id));
}
// Put every file back exactly as it was found.
async function restorePlexBaseline(request) {
  for (const [, sel] of baseline) await putPlexSelection(request, sel.partId, sel);
}
// Start state for a test: subtitles off on the episodes.
async function resetPlexSubtitles(request) {
  await capturePlexBaseline(request);
  for (const id of [EP1, EP2]) await putPlexSelection(request, baseline.get(id).partId, { subtitleStreamId: '0' });
}
// …and the film's audio on its original French.
async function resetPlexFilmAudio(request) {
  await capturePlexBaseline(request);
  await putPlexSelection(request, baseline.get(FILM).partId, { audioStreamId: FILM_FRENCH });
}

// Opening the dev/preview page can lose module fetches to a host network
// change; retried a bounded number of times (same as the session-controls journey).
async function openReceiver(context, request) {
  const receiver = await context.newPage();
  await receiver.setViewportSize({ width: 1280, height: 720 });
  const ready = async () => (await call(request, 'GET', `${base}/receiver-ready`)).body?.ready === true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (await ready()) return receiver;
      await receiver.waitForTimeout(1000);
    }
  }
  expect(await ready(), 'virtual receiver never became ready').toBe(true);
  return receiver;
}

const receiverMedia = (receiver) => receiver.evaluate(() => {
  const el = document.querySelector('.video-player video, .audio-player audio, video');
  return el ? { paused: el.paused, time: el.currentTime } : null;
});

async function playOnReceiver(request, receiver, query, contentId) {
  const loaded = await routineLoad(request, query);
  expect(loaded.status).toBe(200);
  expect(loaded.body?.ok).toBe(true);
  await expect.poll(async () => {
    const media = await receiverMedia(receiver); // keeps the receiver page active while waiting
    const snap = await state(request);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === contentId && !!media && !media.paused;
  }, { timeout: 120000 }).toBe(true);
}

// Page bootstrap (dev-module load lost to a host network change) is retried a
// bounded number of times; the behaviour under test still has to happen.
async function openMedia(sender, url, readyTestId) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sender.goto(url, { waitUntil: 'domcontentloaded' });
    try {
      await expect(sender.getByTestId(readyTestId)).toBeVisible({ timeout: 30000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

async function openRemote(sender, navTestId) {
  await openMedia(sender, '/media', navTestId);
  await sender.getByTestId(navTestId).click();
  await expect(sender.getByTestId(`fleet-peek-${DEVICE}`)).toBeVisible({ timeout: 30000 });
  await sender.getByTestId(`fleet-peek-${DEVICE}`).click();
  await expect(sender.getByTestId('peek-panel')).toBeVisible();
}

const streamMints = (page) => {
  const mints = [];
  mints.manifests = []; // the transcode start manifests the page actually fetched
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (/\/transcode\/universal\/start\.(mpd|m3u8)$/.test(url.pathname)) mints.manifests.push(r.url());
    if (url.pathname.startsWith('/api/v1/proxy/plex/stream/')) mints.push({ ratingKey: url.pathname.split('/').at(-1), params: Object.fromEntries(url.searchParams), url: r.url() });
  });
  return mints;
};

test.describe('Subtitles and audio language (STEER.12a)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeAll(async ({ request }) => { await capturePlexBaseline(request); });
  test.afterAll(async ({ request }) => { await restorePlexBaseline(request); });

  test('a screen through its Remote: only the item\'s subtitles, burned in at the same spot, carried to the next episode', async ({ context, page: sender, request }) => {
    await resetPlexSubtitles(request);
    const receiver = await openReceiver(context, request);
    const mints = streamMints(receiver);
    await playOnReceiver(request, receiver, `play=${EP1}`, EP1);
    await openRemote(sender, 'app-nav-fleet');

    // AC2: the menu offers exactly the subtitle streams the file has (plus Off).
    const descriptor = await (await request.get(`/api/v1/play/${EP1}`)).json();
    const fileSubtitles = descriptor.metadata.Media[0].Part[0].Stream.filter((s) => s.streamType === 3).length;
    expect(fileSubtitles).toBeGreaterThan(1);
    const subtitles = sender.getByTestId('pf-subtitles');
    await expect(subtitles).toHaveText(/Subtitles: Off/, { timeout: 30000 });
    // One audio stream: nothing to choose, so no audio control is offered.
    await expect(sender.getByTestId('pf-audio')).toHaveCount(0);
    await subtitles.click();
    const menu = sender.getByTestId('pf-subtitles-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid^="pf-subtitle-"]')).toHaveCount(fileSubtitles + 1);
    await shot(sender, 'steer12a-remote-subtitle-menu');

    // AC1: choose English for the screen through its Remote.
    const before = (await state(request)).position;
    const sent = sender.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`${base}/session/tracks`));
    await sender.getByTestId(`pf-subtitle-${EP1_ENGLISH}`).click();
    const request1 = await sent;
    expect(request1.postDataJSON()).toMatchObject({ subtitle: EP1_ENGLISH });
    expect((await request1.response()).status()).toBe(200);
    await expect.poll(async () => {
      await receiverMedia(receiver);
      const snap = await state(request);
      return snap?.controls?.tracks?.selected?.subtitle === EP1_ENGLISH && snap.state === 'playing';
    }, { timeout: 60000 }).toBe(true);
    // Re-streamed with the chosen stream, at the same spot.
    expect(mints.some((m) => m.ratingKey === '665638' && m.params.subtitleStreamID === EP1_ENGLISH)).toBe(true);
    expect(Math.abs((await state(request)).position - before)).toBeLessThan(30);
    await expect(subtitles).toHaveText(/Subtitles: English/);
    await receiver.waitForTimeout(6000);
    await shot(receiver, 'steer12a-screen-subtitles-burned');
    await shot(sender, 'steer12a-remote-subtitles-on');

    // AC3: the next episode of the same show starts with the choice — its own
    // English stream — without anyone choosing again.
    const mintCount = mints.length;
    await playOnReceiver(request, receiver, `play=${EP2}`, EP2);
    const ep2Mint = mints.slice(mintCount).find((m) => m.ratingKey === '665639');
    expect(ep2Mint?.params?.subtitleStreamID).toBe(EP2_ENGLISH);
    await expect.poll(async () => (await state(request))?.controls?.tracks?.selected?.subtitle, { timeout: 30000 }).toBe(EP2_ENGLISH);
    await expect(subtitles).toHaveText(/Subtitles: English/, { timeout: 15000 });
    await receiver.waitForTimeout(6000);
    await shot(receiver, 'steer12a-next-episode-carries-choice');

    // Off again (and the screen remembers that for the show).
    await subtitles.click();
    await sender.getByTestId('pf-subtitle-off').click();
    await expect.poll(async () => {
      await receiverMedia(receiver);
      return (await state(request))?.controls?.tracks?.selected?.subtitle ?? 'none';
    }, { timeout: 60000 }).toBe('none');
    // Off re-streams plainly: the account has no subtitle selected on this file
    // (the mint restored it), so nothing is selected or burned.
    expect(mints.at(-1)).toMatchObject({ ratingKey: '665639' });
    expect(mints.at(-1).params).not.toHaveProperty('subtitleStreamID');
    await receiver.close();
  });

  test('a screen\'s audio language through its Remote: only the film\'s languages, switched at the same spot', async ({ context, page: sender, request }) => {
    await resetPlexFilmAudio(request);
    try {
      const receiver = await openReceiver(context, request);
      const mints = streamMints(receiver);
      await playOnReceiver(request, receiver, `play=${FILM}`, FILM);
      await openRemote(sender, 'app-nav-fleet');
      const audio = sender.getByTestId('pf-audio');
      await expect(audio).toHaveText(/Audio: Français/, { timeout: 30000 });
      await audio.click();
      const menu = sender.getByTestId('pf-audio-menu');
      await expect(menu.locator('[data-testid^="pf-audio-"]')).toHaveCount(3);
      await expect(menu).toContainText('Türkçe');
      await expect(menu).toContainText('English');
      await shot(sender, 'steer12a-remote-audio-menu');
      const before = (await state(request)).position;
      await sender.getByTestId(`pf-audio-${FILM_ENGLISH}`).click();
      await expect.poll(async () => {
        await receiverMedia(receiver);
        const snap = await state(request);
        return snap?.controls?.tracks?.selected?.audio === FILM_ENGLISH && snap.state === 'playing';
      }, { timeout: 90000 }).toBe(true);
      const englishMint = mints.find((m) => m.ratingKey === '703558' && m.params.audioStreamID === FILM_ENGLISH);
      expect(englishMint).toBeTruthy();
      // The audio that was actually SERVED, not just asked for: take the
      // first segment of the stream the page fetched and read its audio
      // language with ffprobe (the film's original is French).
      expect(mints.manifests.length, 'the page fetched a start manifest').toBeGreaterThan(0);
      const startUrl = mints.manifests.at(-1);
      const master = await (await request.get(startUrl)).text();
      const variant = new URL(master.split('\n').find((l) => l.endsWith('.m3u8')).trim(), startUrl).toString();
      const playlist = await (await request.get(variant)).text();
      const segmentUrl = new URL(playlist.split('\n').find((l) => /\.(ts|m4s|mp4)$/.test(l.trim())).trim(), variant).toString();
      const segmentFile = path.join(EVIDENCE, 'served-segment.ts');
      fs.writeFileSync(segmentFile, await (await request.get(segmentUrl)).body());
      const probed = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', segmentFile], { encoding: 'utf8' });
      expect(probed, 'ffprobe of the served segment').toMatch(/eng/);
      expect(probed).not.toMatch(/fra|fre/);
      expect(Math.abs((await state(request)).position - before)).toBeLessThan(30);
      await expect(audio).toHaveText(/Audio: English/);
      await shot(sender, 'steer12a-remote-audio-english');
      await receiver.close();
    } finally {
      await restorePlexBaseline(request);
    }
  });
});

test.describe('Subtitles on this device (STEER.12a, phone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeAll(async ({ request }) => { await capturePlexBaseline(request); });
  test.afterAll(async ({ request }) => { await restorePlexBaseline(request); });

  test('the same control steers playback here', async ({ page }) => {
    const mints = streamMints(page);
    await openMedia(page, `/media?view=detail&contentId=${EP1}`, 'detail-play-now');
    await page.getByTestId('detail-play-now').click();
    await page.getByTestId('mini-player-open-nowplaying').click();
    const video = page.getByTestId('now-playing-host').locator('video');
    await expect.poll(() => video.evaluate((el) => !el.paused && el.currentTime > 1).catch(() => false), { timeout: 120000 }).toBe(true);
    const subtitles = page.getByTestId('pf-subtitles');
    await expect(subtitles).toBeVisible({ timeout: 30000 });
    await subtitles.click();
    await page.getByTestId(`pf-subtitle-${EP1_ENGLISH}`).click();
    await expect.poll(() => mints.some((m) => m.ratingKey === '665638' && m.params.subtitleStreamID === EP1_ENGLISH), { timeout: 30000 }).toBe(true);
    await expect(subtitles).toHaveText(/Subtitles: English/, { timeout: 30000 });
    await expect.poll(() => video.evaluate((el) => !el.paused && el.currentTime > 1).catch(() => false), { timeout: 120000 }).toBe(true);
    await page.waitForTimeout(5000);
    await shot(page, 'steer12a-this-device-phone');
    await subtitles.click();
    await page.getByTestId('pf-subtitle-off').click();
    await expect.poll(() => mints.length, { timeout: 30000 }).toBeGreaterThan(1);
    await expect.poll(() => mints.at(-1)?.params?.subtitleStreamID ?? 'none', { timeout: 30000 }).toBe('none');
  });
});

test.describe('Show briefly (PLAY.8a, PLAY.8b)', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('a routine camera is shown briefly by default and the programme comes back at its spot, with its queue', async ({ context, request }) => {
    const receiver = await openReceiver(context, request);
    await playOnReceiver(request, receiver, `play=${HOSPITAL}`, HOSPITAL);
    await receiver.waitForTimeout(4000);
    const before = await state(request);

    const camera = await routineLoad(request, 'play=camera:doorbell');
    expect(camera.status).toBe(200);
    expect(camera.body).toMatchObject({ ok: true, appliedAs: 'brief' });
    const brief = receiver.getByTestId('screen-brief');
    await expect(brief).toBeVisible({ timeout: 10000 });
    await expect(brief).toHaveAttribute('data-brief-kind', 'camera');
    // AC3 (PLAY.8a): what interrupted and where it came from.
    await expect(receiver.getByTestId('screen-brief-label')).toHaveText('Doorbell · from Automation');
    await expect(receiver.getByTestId('screen-brief-return')).toHaveText(/^Back to Hospital in \d+s$/);
    await expect.poll(async () => (await state(request))?.state, { timeout: 10000 }).toBe('paused');
    await shot(receiver, 'play8b-routine-camera-brief');

    // AC2: its time runs out; the programme returns at its spot, playing.
    await expect(brief).toBeHidden({ timeout: 45000 });
    await expect.poll(async () => {
      await receiverMedia(receiver);
      const snap = await state(request);
      return snap?.state === 'playing' && snap.currentItem?.contentId === HOSPITAL;
    }, { timeout: 30000 }).toBe(true);
    const after = await state(request);
    expect(after.position).toBeGreaterThanOrEqual(before.position - 3);
    expect(after.position).toBeLessThan(before.position + 40);
    expect(after.queue.items.map((i) => i.contentId)).toEqual(before.queue.items.map((i) => i.contentId));
    await shot(receiver, 'play8b-programme-returned');

    // PLAY.8b/AC2 "unless the routine says otherwise": brief=0 takes the screen.
    const takeover = await routineLoad(request, 'play=camera:doorbell&brief=0');
    expect(takeover.body).toMatchObject({ ok: true, appliedAs: 'brief' });
    await expect(brief).toBeVisible({ timeout: 10000 });
    await expect(receiver.getByTestId('screen-brief-return')).toHaveCount(0);
    await expect.poll(async () => (await state(request))?.state, { timeout: 15000 }).not.toBe('playing');
    await receiver.getByTestId('screen-brief-close').click();
    await expect(brief).toBeHidden();
    await receiver.waitForTimeout(3000);
    expect((await state(request))?.state).not.toBe('playing');
    await receiver.close();
  });

  test('Show briefly on… from the Media app puts a clip over the programme; closing it from the Remote brings it back', async ({ context, page: sender, request }) => {
    const receiver = await openReceiver(context, request);
    await playOnReceiver(request, receiver, `play=${HOSPITAL}`, HOSPITAL);
    await receiver.waitForTimeout(3000);
    const before = await state(request);

    const loads = [];
    sender.on('request', (r) => { if (r.url().includes(`${base}/load`)) loads.push(new URL(r.url())); });
    await openMedia(sender, `/media?view=detail&contentId=${KEEPY_UPPY}`, 'detail-show-briefly');
    await sender.getByTestId('detail-show-briefly').click();
    await sender.getByTestId(`picker-device-${DEVICE}`).click();
    await shot(sender, 'play8a-show-briefly-picker');
    await sender.getByTestId('picker-submit').click();
    await expect.poll(() => loads.length, { timeout: 15000 }).toBe(1);
    expect(loads[0].searchParams.get('play')).toBe(KEEPY_UPPY);
    expect(loads[0].searchParams.get('brief')).toBe('1');

    // AC1: over what's playing; AC3: names what and from where.
    const brief = receiver.getByTestId('screen-brief');
    await expect(brief).toBeVisible({ timeout: 15000 });
    await expect(brief).toHaveAttribute('data-brief-kind', 'clip');
    await expect(receiver.getByTestId('screen-brief-label')).toHaveText(/^Keepy Uppy · from /);
    await expect(receiver.getByTestId('screen-brief-return')).toHaveText('Back to Hospital after this');
    await expect.poll(async () => receiver.locator('.screen-brief video').evaluate((el) => !el.paused && el.currentTime > 1).catch(() => false), { timeout: 60000 }).toBe(true);
    const during = await state(request);
    expect(during.currentItem.contentId).toBe(HOSPITAL);
    expect(during.state).toBe('paused');
    expect(during.controls.brief).toMatchObject({ kind: 'clip', contentId: KEEPY_UPPY, returnTo: { contentId: HOSPITAL } });
    await shot(receiver, 'play8a-clip-over-programme');

    // The Remote says so and closes it.
    await sender.getByTestId('app-nav-fleet').click();
    await sender.getByTestId(`fleet-peek-${DEVICE}`).click();
    await expect(sender.getByTestId('pf-brief')).toHaveText(/^Showing Keepy Uppy · from /, { timeout: 15000 });
    await shot(sender, 'play8a-remote-shows-brief');
    await sender.getByTestId('pf-brief-close').click();
    await expect(brief).toBeHidden({ timeout: 15000 });
    // AC2: previous programme at its spot, with its queue, playing again.
    await expect.poll(async () => {
      await receiverMedia(receiver);
      const snap = await state(request);
      return snap?.state === 'playing' && snap.currentItem?.contentId === HOSPITAL;
    }, { timeout: 30000 }).toBe(true);
    const after = await state(request);
    expect(Math.abs(after.position - during.position)).toBeLessThan(10);
    expect(after.queue.items.map((i) => i.contentId)).toEqual(before.queue.items.map((i) => i.contentId));
    await expect(sender.getByTestId('pf-brief')).toHaveCount(0);
    await receiver.close();
  });
});

async function startSlideshow(request, receiver) {
  const loaded = await routineLoad(request, 'queue=fixture:slideshow');
  expect(loaded.body?.ok).toBe(true);
  await expect.poll(async () => {
    await receiver.evaluate(() => document.title);
    const snap = await state(request);
    // A screen publishes a running image slideshow as playing or buffering
    // (there is no media element to prove frames; see playerSessionBridge).
    return snap?.currentItem?.format === 'image' && ['playing', 'buffering'].includes(snap.state);
  }, { timeout: 60000 }).toBe(true);
}
const musicAudio = (receiver) => receiver.evaluate(() => {
  const el = [...document.querySelectorAll('[data-testid="music-behind-layer"] audio')].find((a) => a.currentSrc);
  return el ? { paused: el.paused, time: el.currentTime, src: el.currentSrc } : null;
});

async function addMusicBehind(sender) {
  await sender.getByTestId('pf-music-add').click();
  const picker = sender.getByTestId('pf-music-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: 'Search music…' }).fill('Faith');
  const option = sender.getByTestId(`combobox-option-${FAITH}`);
  await expect(option).toBeVisible({ timeout: 30000 });
  await option.click();
}

test.describe('Music behind a slideshow (PLAY.9a)', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('choose music, steer it apart from the photos, and keep it when the slideshow stops', async ({ context, page: sender, request }) => {
    const receiver = await openReceiver(context, request);
    await startSlideshow(request, receiver);
    await openRemote(sender, 'app-nav-fleet');

    // AC1: offered while the slideshow plays; choose a song.
    await expect(sender.getByTestId('pf-music-add')).toBeVisible({ timeout: 30000 });
    await addMusicBehind(sender);
    await expect.poll(async () => (await state(request))?.controls?.musicBehind?.state, { timeout: 60000 }).toBe('playing');
    await expect.poll(async () => (await musicAudio(receiver))?.paused, { timeout: 30000 }).toBe(false);
    await expect(receiver.getByTestId('screen-music-plaque')).toHaveText(/Faith/);
    await expect(sender.getByTestId('pf-music-title')).toHaveText('Faith', { timeout: 15000 });
    await shot(receiver, 'play9a-screen-music-behind');
    await shot(sender, 'play9a-remote-music-controls');

    // AC2: skipping a photo doesn't skip the song.
    const photoBefore = (await state(request)).currentItem.contentId;
    const songBefore = await musicAudio(receiver);
    await sender.getByTestId('np-next').click();
    await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 15000 }).not.toBe(photoBefore);
    const songAfter = await musicAudio(receiver);
    expect(songAfter.src).toBe(songBefore.src);
    expect(songAfter.time).toBeGreaterThanOrEqual(songBefore.time);
    // …and pausing the song doesn't pause the photos.
    await sender.getByTestId('pf-music-toggle').click();
    await expect.poll(async () => (await musicAudio(receiver))?.paused, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => (await state(request))?.controls?.musicBehind?.state, { timeout: 15000 }).toBe('paused');
    // The photos keep running (a slideshow publishes as playing).
    expect((await state(request)).state).toBe('playing');
    expect((await state(request)).currentItem.format).toBe('image');
    await sender.getByTestId('pf-music-toggle').click();
    await expect.poll(async () => (await musicAudio(receiver))?.paused, { timeout: 15000 }).toBe(false);

    // AC3: stopping the slideshow asks whether to keep the music.
    await sender.getByTestId('np-stop').click();
    await expect(sender.getByTestId('pf-stop-guard')).toContainText('Keep the music playing?');
    await shot(sender, 'play9a-stop-asks-keep-music');
    await sender.getByTestId('pf-stop-keep-music').click();
    await expect.poll(async () => (await state(request))?.state, { timeout: 15000 }).toMatch(/^(ready|idle)$/);
    await receiver.waitForTimeout(2000);
    expect((await musicAudio(receiver))?.paused).toBe(false);
    expect((await state(request)).controls.musicBehind.state).toBe('playing');
    await shot(receiver, 'play9a-music-kept-after-slideshow');
    await sender.getByTestId('pf-music-stop').click();
    await expect.poll(async () => (await state(request))?.controls?.musicBehind ?? null, { timeout: 15000 }).toBeNull();
    await expect(receiver.getByTestId('screen-music-plaque')).toHaveCount(0);
    await receiver.close();
  });
});

test.describe('Music behind on a phone (PLAY.9a)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Stop music too stops both', async ({ context, page: sender, request }) => {
    const receiver = await openReceiver(context, request);
    await startSlideshow(request, receiver);
    await openRemote(sender, 'app-tab-fleet');
    await expect(sender.getByTestId('pf-music-add')).toBeVisible({ timeout: 30000 });
    await addMusicBehind(sender);
    await expect.poll(async () => (await state(request))?.controls?.musicBehind?.state, { timeout: 60000 }).toBe('playing');
    await expect(sender.getByTestId('pf-music-stop')).toBeVisible();
    await shot(sender, 'play9a-phone-music-controls');
    await sender.getByTestId('np-stop').click();
    await sender.getByTestId('pf-stop-both').click();
    await expect.poll(async () => (await state(request))?.controls?.musicBehind ?? null, { timeout: 15000 }).toBeNull();
    await expect.poll(async () => (await state(request))?.state, { timeout: 15000 }).toMatch(/^(ready|idle)$/);
    await receiver.close();
  });
});
