import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const member = { username: 'amy', displayName: 'Amy' };
const card = { cardId: 'fixture-voice', kind: 'email', step: 'unsure', status: 'open',
  display: { title: 'Voice fixture', snippet: 'Synthetic message', source: 'Fixture' },
  choices: [{ key: 'keep', label: 'Keep in inbox' }],
};
const nextCard = {
  ...card, cardId: 'fixture-next',
  display: { ...card.display, title: 'Next voice fixture' },
};
const microphone = { audio: { deviceId: { exact: 'internal' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
const bytes = 'synthetic-voice';

async function installVoice(page, { cards = [card], holdTranscript = false } = {}) {
  const commands = [];
  const transcriptionStarted = Promise.withResolvers();
  const transcript = Promise.withResolvers();
  const canceled = [];
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/v1/ai/transcribe') canceled.push(request.postDataJSON());
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: member });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [member] } });
    if (request.method() !== 'GET' && /\/triage\/|\/ai\/transcribe$|\/feedback(?:\/|$)/.test(pathname)) {
      commands.push([pathname, request.postDataJSON()]);
    }
    if (pathname.endsWith('/triage/summary')) return route.fulfill({ json: { enrolled: true, mode: 'live' } });
    if (pathname.endsWith('/triage/session')) return route.fulfill({ json: {
      steps: [{ id: 'unsure', count: cards.length }], cards, total: cards.length, done: 0,
    } });
    if (pathname.endsWith('/ai/transcribe')) {
      if (holdTranscript) {
        transcriptionStarted.resolve();
        await transcript.promise;
        if (canceled.length) return;
      }
      return route.fulfill({ json: { text: 'Synthetic transcript' } });
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(({ bytes }) => {
    const requests = [];
    const clocks = new Set();
    const metrics = { requests: [], starts: [], stopped: [], contexts: [], closed: [], frames: 0 };
    window.voiceFixture = { metrics, clocks, grant(index) {
      requests[index]({ getTracks: () => [{ stop() { metrics.stopped.push(index); } }], index });
    } };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: async () => [
        { kind: 'audioinput', label: 'Bluetooth headset', deviceId: 'bluetooth' },
        { kind: 'audioinput', label: 'Built-in microphone', deviceId: 'internal' },
      ],
      getUserMedia(constraints) {
        metrics.requests.push(constraints);
        return new Promise(resolve => requests.push(resolve));
      },
    } });
    const setInterval = window.setInterval.bind(window);
    const clearInterval = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      const handle = setInterval(callback, delay, ...args);
      if (delay === 200) clocks.add(handle);
      return handle;
    };
    window.clearInterval = handle => { clocks.delete(handle); clearInterval(handle); };
    window.MediaRecorder = class {
      static isTypeSupported(mime) { return mime === 'audio/webm;codecs=opus'; }
      state = 'inactive';
      constructor(stream, { mimeType }) { this.stream = stream; this.mimeType = mimeType; }
      start() { this.state = 'recording'; metrics.starts.push([this.stream.index, this.mimeType]); }
      requestData() { this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) }); }
      stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
    };
    window.AudioContext = class {
      createAnalyser() { return { frequencyBinCount: 4, getByteTimeDomainData: buf => { metrics.frames += 1; buf.fill(128); } }; }
      createMediaStreamSource(stream) { this.index = stream.index; metrics.contexts.push(stream.index); return { connect() {} }; }
      close() { metrics.closed.push(this.index); return Promise.resolve(); }
    };
  }, { bytes });
  const metrics = () => page.evaluate(() => ({ ...window.voiceFixture.metrics, clocks: window.voiceFixture.clocks.size }));
  const grant = index => page.evaluate(async index => {
    window.voiceFixture.grant(index);
    await new Promise(requestAnimationFrame);
  }, index);
  return { commands, metrics, grant, transcriptionStarted, transcript, canceled };
}

async function triage(page, options) {
  const voice = await installVoice(page, options);
  await page.goto('/life/now/triage');
  const main = page.getByRole('main');
  await expect(main.getByText(card.display.title)).toBeVisible();
  return { ...voice, main, microphoneButton: main.getByRole('button', { name: 'Speak your answer' }) };
}

test('Life Triage releases a late microphone grant when leaving the route', async ({ page }) => {
  const { microphoneButton, commands, metrics, grant } = await triage(page);
  await microphoneButton.click();
  await expect.poll(async () => (await metrics()).requests).toEqual([microphone]);
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await expect(page).toHaveURL('/life/log');
  await expect(microphoneButton).toHaveCount(0);
  await grant(0);
  expect(await metrics()).toMatchObject({ starts: [], stopped: [0], contexts: [], frames: 0, clocks: 0 });
  expect(commands).toEqual([]);
});

test('Life Triage admits one start during repeated microphone taps', async ({ page }) => {
  const { main, microphoneButton, commands, metrics, grant } = await triage(page);
  await microphoneButton.click();
  await expect.poll(async () => (await metrics()).requests).toEqual([microphone]);
  await microphoneButton.click();
  await grant(0);
  await expect(main.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  expect(await metrics()).toMatchObject({ requests: [microphone], starts: [[0, 'audio/webm;codecs=opus']], contexts: [0], clocks: 1 });
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await expect.poll(metrics).toMatchObject({ stopped: [0], closed: [0], clocks: 0 });
  expect(commands).toEqual([]);
});

test('Life Triage transcribes captured bytes into the current answer draft for review', async ({ page }) => {
  const { main, microphoneButton, commands, metrics, grant, transcriptionStarted, transcript }
    = await triage(page, { holdTranscript: true });
  try {
    await microphoneButton.click();
    await expect.poll(async () => (await metrics()).requests).toEqual([microphone]);
    await grant(0);
    await main.getByRole('button', { name: 'Stop recording' }).click();
    await transcriptionStarted.promise;
    const answer = main.getByRole('textbox', { name: 'Answer in your own words' });
    await answer.fill('My draft');
    transcript.resolve();
    await expect(answer).toHaveValue('My draft Synthetic transcript');
    expect(commands).toEqual([['/api/v1/ai/transcribe', { audioBase64: Buffer.from(bytes).toString('base64') }]]);
    expect(await metrics()).toMatchObject({ starts: [[0, 'audio/webm;codecs=opus']], stopped: [0], closed: [0], clocks: 0 });
  } finally {
    transcript.resolve();
  }
});

test.describe('Life Triage touch targets', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 850 } });

  test('uses the shared touch minimum for record, stop and send while preserving explicit submit', async ({ page }) => {
    const { main, microphoneButton, commands, metrics, grant } = await triage(page);
    const answer = main.getByRole('textbox', { name: 'Answer in your own words' });
    const send = main.getByRole('button', { name: 'Send answer' });
    const stop = main.getByRole('button', { name: 'Stop recording' });
    const expectTarget = async control => {
      await expect(control).toBeVisible();
      const { width, height } = await control.boundingBox();
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    };
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await answer.fill('My draft');
    await expectTarget(microphoneButton);
    await expectTarget(send);
    await microphoneButton.tap({ position: { x: 1, y: 22 } });
    await expect.poll(async () => (await metrics()).requests).toEqual([microphone]);
    await grant(0);
    await expectTarget(stop);
    await stop.press('Enter');
    await expect(answer).toHaveValue('My draft Synthetic transcript');
    expect(commands.map(([path]) => path)).toEqual(['/api/v1/ai/transcribe']);

    await send.press('Enter');
    await expect.poll(() => commands).toEqual([
      ['/api/v1/ai/transcribe', { audioBase64: Buffer.from(bytes).toString('base64') }],
      [`/api/v1/triage/cards/${card.cardId}/answer`, { text: 'My draft Synthetic transcript' }],
    ]);
  });
});

for (const destination of ['the next card', 'another route']) {
  test(`Life Triage cancels a transcript while moving to ${destination}`, async ({ page }) => {
    const { main, microphoneButton, commands, metrics, grant, transcriptionStarted, transcript, canceled }
      = await triage(page, { cards: [card, nextCard], holdTranscript: true });
    try {
      await microphoneButton.click();
      await expect.poll(async () => (await metrics()).requests).toEqual([microphone]);
      await grant(0);
      await main.getByRole('button', { name: 'Stop recording' }).click();
      await transcriptionStarted.promise;
      const audio = { audioBase64: Buffer.from(bytes).toString('base64') };
      if (destination === 'the next card') {
        await main.getByRole('button', { name: 'Skip for now' }).click();
        await expect(main.getByText(nextCard.display.title)).toBeVisible();
      } else {
        await page.getByRole('link', { name: 'Log', exact: true }).click();
        await expect(page).toHaveURL('/life/log');
      }

      await expect.poll(() => canceled).toEqual([audio]);
      transcript.resolve();
      if (destination === 'another route') {
        await page.goBack();
        await expect(main.getByText(card.display.title)).toBeVisible();
      }
      await expect(main.getByRole('textbox', { name: 'Answer in your own words' })).toHaveValue('');
      expect(commands).toEqual(destination === 'the next card'
        ? [['/api/v1/ai/transcribe', audio], [`/api/v1/triage/cards/${card.cardId}/skip`, {}]]
        : [['/api/v1/ai/transcribe', audio]]);
    } finally {
      transcript.resolve();
    }
  });
}

test('Piano Feedback releases a late grant while its maintenance drawer stays mounted', async ({ page }) => {
  const { commands, metrics, grant } = await installVoice(page);
  await page.goto('/piano');
  const chip = page.getByRole('button', { name: /Change sound/ });
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const drawer = page.getByRole('dialog', { name: 'Piano maintenance' });
  await expect(drawer).toBeVisible();
  await page.mouse.up();
  const feedback = page.getByRole('dialog', { name: 'Feedback', exact: true });
  await drawer.getByRole('button', { name: /Record feedback/ }).click();
  await feedback.getByRole('button', { name: 'Record', exact: true }).click();
  await expect.poll(async () => (await metrics()).requests).toEqual([microphone]);
  await feedback.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(feedback).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await grant(0);
  await drawer.getByRole('button', { name: /Record feedback/ }).click();
  await expect(feedback.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
  expect(await metrics()).toMatchObject({ starts: [], stopped: [0], contexts: [], frames: 0, clocks: 0 });
  expect(commands).toEqual([]);
});
