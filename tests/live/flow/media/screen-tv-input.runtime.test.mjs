import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// TV input rule: a screen on the Shield/FKB has only the D-pad (arrows), OK
// (Enter) and an UNRELIABLE Back — FKB swallows Esc. Every prompt a screen
// shows over playback must therefore be operable with the D-pad and OK alone.
// Real mounted screen page (virtual receiver); only Enter/arrow keys are
// pressed on it — never Escape, never a pointer.
test.use({ viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(240000);
test.describe.configure({ mode: 'serial' });

const DEVICE = 'acceptance-media';
const base = `/api/v1/device/${DEVICE}`;
const EP_HOSPITAL = 'plex:266151';
const EP_KEEPY = 'plex:266152';
const phone = { kind: 'device', id: 'browser:acceptance-phone', name: 'Test phone' };

async function call(request, method, path, body) {
  const response = await request.fetch(path, { method, data: body ? { commandId: randomUUID(), ...body } : undefined });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
const state = async (request) => (await call(request, 'GET', `${base}/receiver-state`)).body?.snapshot ?? null;

async function openReceiver(context, request) {
  const receiver = await context.newPage();
  const ready = async () => (await call(request, 'GET', `${base}/receiver-ready`)).body?.ready === true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (await ready()) { await receiver.waitForTimeout(1500); return receiver; }
      await receiver.waitForTimeout(1000);
    }
  }
  expect(await ready(), 'virtual receiver never became ready').toBe(true);
  return receiver;
}

async function startPlaying(request, contentId) {
  expect((await call(request, 'GET', `${base}/load?play=${encodeURIComponent(contentId)}&dispatchId=${randomUUID()}`)).status).toBe(200);
  await expect.poll(async () => {
    const snap = await state(request);
    return snap?.state === 'playing' && snap?.currentItem?.contentId === contentId;
  }, { timeout: 120000 }).toBe(true);
}

test('[TV input] the next-episode countdown has focus on Cancel, the D-pad reaches Play now, and OK cancels it', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  try {
    await startPlaying(request, EP_HOSPITAL);
    expect((await call(request, 'GET', `${base}/load?play=${EP_KEEPY}&op=add&dispatchId=${randomUUID()}`)).status).toBe(200);
    await expect.poll(async () => (await state(request))?.queue?.items?.some((i) => i.contentId === EP_KEEPY), { timeout: 30000 }).toBe(true);
    const duration = await receiver.locator('video').evaluate((el) => el.duration);
    expect((await call(request, 'POST', `${base}/session/transport`, { action: 'seekAbs', value: Math.max(0, duration - 6) })).status).toBe(200);
    const countdown = receiver.getByTestId('screen-next-countdown');
    await expect(countdown).toBeVisible({ timeout: 30000 });
    await expect(receiver.getByTestId('screen-next-countdown-cancel')).toBeFocused();
    await receiver.keyboard.press('ArrowRight');
    await expect(receiver.getByTestId('screen-next-countdown-start')).toBeFocused();
    await receiver.keyboard.press('ArrowLeft');
    await expect(receiver.getByTestId('screen-next-countdown-cancel')).toBeFocused();
    await receiver.keyboard.press('Enter'); // OK
    await expect(countdown).toHaveCount(0);
    await expect.poll(async () => (await state(request))?.currentItem?.contentId, { timeout: 15000 }).toBe(EP_HOSPITAL);
  } finally {
    await call(request, 'POST', `${base}/session/transport`, { action: 'stop' }).catch(() => {});
    await receiver.close();
  }
});

test('[TV input] OK presses Put it back after another device pauses the screen', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  try {
    await startPlaying(request, EP_HOSPITAL);
    expect((await call(request, 'POST', `${base}/session/transport`, { action: 'pause', origin: phone })).status).toBe(200);
    await expect(receiver.getByTestId('screen-note-put-back')).toBeVisible({ timeout: 10000 });
    await receiver.keyboard.press('Enter'); // OK
    await expect.poll(async () => (await state(request))?.state, { timeout: 30000 }).toBe('playing');
    await expect(receiver.getByTestId('screen-note-put-back')).toHaveCount(0);
  } finally {
    await call(request, 'POST', `${base}/session/transport`, { action: 'stop' }).catch(() => {});
    await receiver.close();
  }
});

test('[TV input] OK keeps the screen playing while the sleep timer fades it', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  try {
    await startPlaying(request, EP_HOSPITAL);
    expect((await call(request, 'POST', `${base}/session/sleep-timer`, { minutes: 0.25 })).status).toBe(200);
    await expect(receiver.getByTestId('screen-sleep-fading')).toBeVisible({ timeout: 20000 });
    await receiver.keyboard.press('Enter'); // OK
    await expect(receiver.getByTestId('screen-sleep-fading')).toHaveCount(0);
    await expect.poll(async () => (await state(request))?.controls?.sleepTimer ?? null, { timeout: 10000 }).toBeNull();
    // It was not stopped at the timer's end.
    await receiver.waitForTimeout(12000);
    expect((await state(request))?.state).toBe('playing');
    await expect.poll(async () => receiver.locator('video').evaluate((el) => el.volume), { timeout: 15000 }).toBeGreaterThan(0.9);
  } finally {
    await call(request, 'POST', `${base}/session/transport`, { action: 'stop' }).catch(() => {});
    await receiver.close();
  }
});

test('[TV input] Show briefly: Close holds focus and OK closes it, returning the programme', async ({ context, request }) => {
  const receiver = await openReceiver(context, request);
  try {
    await startPlaying(request, EP_HOSPITAL);
    // A brief clip over the programme (the same envelope a routine or doorbell sends).
    const brief = await call(request, 'GET', `${base}/load?play=${EP_KEEPY}&brief=1&dispatchId=${randomUUID()}`);
    expect(brief.status, 'brief accepted').toBe(200);
    const bar = receiver.getByTestId('screen-brief');
    await expect(bar).toBeVisible({ timeout: 30000 });
    await expect(receiver.getByTestId('screen-brief-close')).toBeFocused();
    await receiver.keyboard.press('Enter'); // OK
    await expect(bar).toHaveCount(0);
  } finally {
    await call(request, 'POST', `${base}/session/transport`, { action: 'stop' }).catch(() => {});
    await receiver.close();
  }
});
