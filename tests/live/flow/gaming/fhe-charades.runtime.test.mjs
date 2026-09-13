import { test, expect } from '@playwright/test';

// Real network, real media, remote keys only. BASE_URL selects the deployment;
// normal Playwright config derives its local port from the system configuration.
test('FHE Charades completes all eighteen remote-controlled casual turns', async ({ page, request }, testInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 960, height: 540 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const gameFailures = [];
  page.on('response', response => {
    if (response.status() >= 400 && response.url().includes('/api/v1/gaming/')) gameFailures.push({url:response.url(),status:response.status()});
  });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__fheAudioElements = [];
    window.Audio = function (...args) {
      const element = new NativeAudio(...args);
      window.__fheAudioElements.push(element);
      return element;
    };
    window.Audio.prototype = NativeAudio.prototype;
    window.__fheWheelSelections = [];
    const observedWheels = new WeakSet();
    new MutationObserver(() => {
      document.querySelectorAll('.family-selector[data-selected-id]').forEach(wheel => {
        const id = wheel.getAttribute('data-selected-id');
        if (id && !observedWheels.has(wheel)) {
          observedWheels.add(wheel); window.__fheWheelSelections.push(id);
        }
      });
    }).observe(document, {subtree:true,childList:true,attributes:true,attributeFilter:['data-selected-id']});
  });

  const focusRemote = async (pattern) => {
    for (let step = 0; step < 35; step++) {
      const label = await page.evaluate(() => document.activeElement?.textContent || '');
      if (pattern.test(label)) return;
      await page.keyboard.press('ArrowDown');
    }
    throw new Error(`Remote could not focus ${pattern}`);
  };
  const stage = page.locator('main.charades');
  const phase = async (value, timeout = 20_000) => expect(stage).toHaveAttribute('data-phase', value, {timeout});
  const expectFits = async locator => {
    const clipped = await locator.evaluate(root => [root, ...root.querySelectorAll('button, img, .segmented-secret-text, .image-decoder-display')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => { const b = el.getBoundingClientRect(); return b.bottom > innerHeight + 1 || b.right > innerWidth + 1 || b.top < -1 || b.left < -1; })
      .map(el => ({tag:el.tagName,className:el.className,text:el.textContent?.slice(0,80)})));
    expect(clipped, 'Controls and clue must fit the actual TV CSS viewport').toEqual([]);
  };
  const api = async (path) => {
    const response = await request.get(path);
    expect(response.ok(), `${path}: ${response.status()}`).toBe(true);
    return response.json();
  };

  await page.goto('/screens/living-room/fhe', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.menu-item').filter({hasText:'Charades'})).toBeVisible();
  for (let step = 0; step < 25 && !(await page.locator('.menu-item.active').innerText()).includes('Charades'); step++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.menu-item.active')).toContainText('Charades');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('team-setup')).toBeVisible();
  await expect(page.getByTestId('teams-confirm')).toHaveText('Start with 6 players');
  await expect(page.getByRole('button', {name:'Teams',exact:true})).toHaveCount(0);
  await expectFits(page.getByTestId('team-setup'));
  // Exercise the actual roster controls before keeping all six participants.
  const rosterButton = page.locator('.gp-teamsetup__individuals button[aria-pressed]').first();
  const rosterName = (await rosterButton.innerText()).trim();
  await focusRemote(new RegExp(`^${rosterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await page.keyboard.press('Enter');
  await expect(rosterButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('teams-confirm')).toHaveText('Start with 5 players');
  await page.keyboard.press('Enter');
  await expect(rosterButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('teams-confirm')).toHaveText('Start with 6 players');
  await focusRemote(/Start with 6 players/);
  const createdPromise = page.waitForResponse(r => r.url().endsWith('/api/v1/gaming/sessions') && r.request().method() === 'POST');
  await page.keyboard.press('Enter');
  const createdResponse = await createdPromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const sessionId = created.header.session_id;
  const sessionPath = `/api/v1/gaming/sessions/${encodeURIComponent(sessionId)}`;
  const read = () => api(sessionPath);
  const seatIds = created.header.seats.map(seat => seat.id);
  expect(new Set(seatIds).size).toBe(6);
  const initial = await read();
  const definition = initial.definition;
  expect(definition).toMatchObject({rounds:3,timer_ms:60_000,clues_per_turn:1,competition:false});
  expect(definition.presentation.image_participants).toHaveLength(2);
  const musicQueue = await api(`/api/v1/queue/${encodeURIComponent(definition.guessing_music.source)}`);
  const mediaUrls = musicQueue.items.map(item => item.mediaUrl);
  expect(mediaUrls.length).toBeGreaterThan(0);
  const musicState = () => page.evaluate(urls => (window.__fheAudioElements || [])
    .filter(a => urls.some(url => a.src === new URL(url, location.origin).href))
    .map(a => ({paused:a.paused,time:a.currentTime,ready:a.readyState})), mediaUrls);
  const turns = [];
  const imageIds = [];
  const textIds = [];

  for (let turn = 0; turn < 18; turn++) {
    await phase('challenge-ready');
    const ready = await read();
    expect(ready.state.challenge_index).toBe(turn);
    expect(ready.state.round).toBe(Math.floor(turn / 6) + 1);
    expect(ready.state.deadline).toBeNull();
    expect(ready.state.scores).toEqual({});
    // Reload on turn 2 resets browser observation, but preserves the schedule.
    const wheelIndex = turn < 2 ? turn : turn - 2;
    expect(await page.evaluate(index => window.__fheWheelSelections[index], wheelIndex)).toBe(String(ready.state.performer_id));
    const actor = created.header.seats.find(seat => seat.id === ready.state.performer_id);
    await expect(stage).toContainText(actor.name);
    turns.push(ready.state.performer_id);
    const imageTurn = definition.presentation.image_participants.includes(ready.state.performer_id);
    expect(ready.state.clue_presentation).toBe(imageTurn ? 'image' : 'text');
    if (imageTurn) {
      imageIds.push(ready.state.challenge.id);
      await expect(stage.locator('.image-decoder-display')).toHaveAttribute('data-status', 'ready');
      const asset = await request.get(ready.state.challenge.decoder.image);
      expect(asset.ok()).toBe(true);
      expect(asset.headers()['content-type']).toContain('image/svg+xml');
      expect(await asset.text()).toContain('<svg');
      await page.screenshot({path:testInfo.outputPath(`image-${ready.state.challenge.id}.png`)});
      // Inspect the emitted red channel as an optical QA approximation. This
      // does not claim to replace testing the family's physical decoder card.
      await stage.locator('.image-decoder-display').evaluate(el => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'fhe-optics-probe';
        svg.style.cssText = 'position:absolute;width:0;height:0';
        svg.innerHTML = '<defs><filter id="fhe-red-channel" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 1 0"/></filter></defs>';
        document.body.append(svg);
        el.style.filter = 'url(#fhe-red-channel)';
      });
      await page.screenshot({path:testInfo.outputPath(`image-${ready.state.challenge.id}-red-channel.png`)});
      await stage.locator('.image-decoder-display').evaluate(el => {
        el.style.removeProperty('filter'); document.getElementById('fhe-optics-probe').remove();
      });
    } else {
      textIds.push(ready.state.challenge.id);
      await expect(stage.locator('.image-decoder-display')).toHaveCount(0);
      await expect(stage.locator('svg').first()).toBeVisible();
    }
    expect((await musicState()).some(a => !a.paused)).toBe(false);
    await expectFits(stage);
    if (turn === 0) {
      await page.screenshot({path:testInfo.outputPath('decoder-ready.png')});
      await page.waitForTimeout(61_000);
      await phase('challenge-ready');
      expect((await read()).state.deadline).toBeNull();
      expect((await musicState()).some(a => !a.paused)).toBe(false);
    }
    await focusRemote(/^(Go|Start acting)/i);
    await page.keyboard.down('Enter');
    await phase('performing');
    // Repeated keydowns from the same held remote button cannot end acting.
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await phase('performing');
    await page.keyboard.up('Enter');
    await expect.poll(async () => (await musicState()).some(a => !a.paused && a.time > 0.1 && a.ready >= 2), {timeout:20_000}).toBe(true);
    await expectFits(stage);
    const started = await read();
    expect(started.state.deadline).toBeGreaterThan(Date.now());
    if (turn === 1) {
      const deadline = started.state.deadline;
      await page.reload({waitUntil:'domcontentloaded'});
      await phase('performing');
      const resumed = await read();
      expect(resumed.header.session_id).toBe(sessionId);
      expect(resumed.state.deadline).toBe(deadline);
      expect(resumed.state.challenge.id).toBe(ready.state.challenge.id);
      await expect.poll(async () => (await musicState()).some(a => !a.paused && a.time > 0), {timeout:20_000}).toBe(true);
    }
    if (turn === 2) {
      await phase('challenge-complete', 70_000);
    } else {
      await focusRemote(/finish|stop timer|end turn/i);
      await page.keyboard.press('Enter');
      await phase('challenge-complete');
    }
    await expect.poll(async () => (await musicState()).some(a => !a.paused)).toBe(false);
    await expect(stage).toContainText(ready.state.challenge.prompt);
    if (imageTurn) {
      const revealedImage = stage.getByRole('img', {name:ready.state.challenge.prompt,exact:true});
      await expect(revealedImage).toBeVisible();
      await expect(revealedImage).toHaveAttribute('src', ready.state.challenge.decoder.image);
      await expect.poll(() => revealedImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(stage.locator('.image-decoder-display')).toHaveCount(0);
    }
    await expectFits(stage);
    await expect(stage).not.toContainText(/score committed|guessed it|not guessed|wins/i);
    await focusRemote(/next|finish|complete/i);
    await page.keyboard.press('Enter');
    console.log(`Verified turn ${turn + 1}/18: ${ready.state.performer_id}, ${imageTurn ? 'image' : 'text'}`);
  }
  for (let round = 0; round < 3; round++) expect(turns.slice(round * 6, round * 6 + 6).sort()).toEqual([...seatIds].sort());
  expect(imageIds).toHaveLength(6);
  expect(new Set(imageIds).size).toBe(6);
  expect(textIds).toHaveLength(12);
  expect(new Set(textIds).size).toBe(12);
  expect(imageIds.filter(id => textIds.includes(id))).toEqual([]);
  await expect(page.getByTestId('results')).toBeVisible();
  await expectFits(page.getByTestId('results'));
  const terminal = await read();
  expect(terminal.state.phase).toBe('complete');
  expect(terminal.result).toMatchObject({scores:[],outcome:{kind:'completed'}});
  await expect(page.getByTestId('results')).not.toContainText(/wins|tie|score|rank/i);
  await page.screenshot({path:testInfo.outputPath('casual-results.png')});
  await focusRemote(/exit|return|back to fhe/i);
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-item').filter({hasText:'Charades'})).toBeVisible();
  expect(new URL(page.url()).searchParams.has('session')).toBe(false);
  expect(new URL(page.url()).pathname).toBe('/screens/living-room/fhe');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('.menu-item').filter({hasText:'Charades'})).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(gameFailures).toEqual([]);
  await testInfo.attach('verified-turns', {body:JSON.stringify({sessionId,turns,imageIds,textIds},null,2),contentType:'application/json'});
});
