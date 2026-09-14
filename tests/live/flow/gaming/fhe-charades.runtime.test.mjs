import { test, expect } from '@playwright/test';

// Real network, real media, remote keys only. BASE_URL selects the deployment;
// normal Playwright config derives its local port from the system configuration.
test('FHE Charades completes all eighteen remote-controlled casual turns', async ({ page, request }, testInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 960, height: 540 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const gameFailures = [];
  const creations = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/gaming/sessions')) creations.push(request.postDataJSON()); });
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
    window.__fheSetupSeen = false;
    const observedWheels = new WeakSet();
    new MutationObserver(() => {
      if (document.querySelector('[data-testid=team-setup]')) window.__fheSetupSeen = true;
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
    const clipped = await locator.evaluate(root => {
      const stageContent = root.matches('main.charades') ? root.querySelector(':scope > .charades__center') : null;
      const stageBounds = stageContent?.getBoundingClientRect();
      return [root, ...root.querySelectorAll('button, img, h2, .segmented-secret-text, .segmented-secret-text__glyph, .image-decoder-display, .charades__countdown')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .filter(el => {
        const b = el.getBoundingClientRect();
        const outsideViewport = b.bottom > innerHeight + 1 || b.right > innerWidth + 1 || b.top < -1 || b.left < -1;
        const outsideStage = stageBounds && stageContent.contains(el)
          && (b.top < stageBounds.top - 1 || b.bottom > stageBounds.bottom + 1 || b.left < stageBounds.left - 1 || b.right > stageBounds.right + 1);
        return outsideViewport || outsideStage;
      })
      .map(el => ({tag:el.tagName,className:el.className,text:el.textContent?.slice(0,80)}));
    });
    expect(clipped, 'Controls and clue must fit the actual TV CSS viewport').toEqual([]);
  };
  const expectActionRail = async name => {
    const action = stage.locator(':scope > .charades__center.charades__with-footer > .charades__primary-action');
    await expect(action).toHaveAccessibleName(name);
    await expect(action.locator(':scope > svg')).toHaveCount(1);
    const placement = await action.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const stageBounds = button.parentElement.getBoundingClientRect();
      return {
        width: Math.round(bounds.width),
        centerError: Math.round(Math.abs((bounds.left + bounds.right) / 2 - (stageBounds.left + stageBounds.right) / 2)),
        bottomGap: Math.round(stageBounds.bottom - bounds.bottom),
      };
    });
    expect(placement.width).toBe(320);
    expect(placement.centerError).toBeLessThanOrEqual(1);
    expect(placement.bottomGap).toBeLessThanOrEqual(20);
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
  await expect(stage).toBeVisible();
  expect(await page.evaluate(() => window.__fheSetupSeen)).toBe(false);
  await expect(page.getByTestId('team-setup')).toHaveCount(0);
  await expect(page.getByRole('button', {name:/Guest|Start with/})).toHaveCount(0);
  const launch = new URL(page.url()).searchParams;
  expect(launch.has('autostart')).toBe(false);
  expect(launch.has('participants')).toBe(false);
  expect(new URL(page.url()).pathname).toBe('/screens/living-room/party-games/charades:fhe');
  expect(creations).toHaveLength(1);
  const initial = await read();
  const definition = initial.definition;
  expect(definition).toMatchObject({rounds:3,timer_ms:60_000,clues_per_turn:1,competition:false});
  expect(definition.guessing_music).toEqual({source:'plex:535255',volume:0.3,order:'shuffle',repeat:'one',memory:'session'});
  expect(definition.sound_cues).toEqual({pack:'charades',volume:0.4,performer_selected:'performer-selected',clue_revealed:'clue-revealed',acting_started:'acting-started',time_up:'time-up',turn_finished:'turn-finished',handoff:'handoff',game_finished:'game-finished'});
  expect(definition.launch).toEqual({autostart:true,participants:seatIds});
  expect(definition.clue_filter).toEqual({categories:['animals','everyday-actions'],levels:['easy']});
  expect(definition.challenges.every(clue => definition.clue_filter.categories.includes(clue.category) && clue.level === 'easy')).toBe(true);
  expect(definition.challenges.length).toBeGreaterThanOrEqual(90);
  const configuredImages = definition.challenges.filter(clue => clue.decoder?.image);
  expect(configuredImages.length).toBeGreaterThanOrEqual(20);
  expect(configuredImages.every(clue => /\/charades\/images\/[a-z-]+\.svg$/.test(clue.decoder.image))).toBe(true);
  expect(definition.presentation.image_participants).toHaveLength(2);
  const musicQueue = await api(`/api/v1/queue/${encodeURIComponent(definition.guessing_music.source)}`);
  const mediaUrls = musicQueue.items.map(item => item.mediaUrl);
  expect(mediaUrls.length).toBeGreaterThan(0);
  const musicState = () => page.evaluate(urls => (window.__fheAudioElements || [])
    .filter(a => urls.some(url => a.src === new URL(url, location.origin).href))
    .map(a => ({src:a.src,paused:a.paused,time:a.currentTime,ready:a.readyState})), mediaUrls);
  const turns = [];
  const imageIds = [];
  const textIds = [];
  const heardTracks = [];

  for (let turn = 0; turn < 18; turn++) {
    await phase('challenge-ready');
    const ready = await read();
    await expect(stage.getByRole('img', {name:`Round ${ready.state.round} of 3`})).toBeVisible();
    await expect(stage.locator('.charades__round-step')).toHaveCount(3);
    await expect(stage.locator('.charades__round-step[data-state="current"]')).toHaveCount(1);
    await expect(stage.locator('.gp-show-header__status .gp-avatar')).toBeVisible();
    await expect(stage).not.toContainText(/Secret clue|Performer only/);
    if (ready.state.clue_presentation !== 'image') {
      await expect(stage.locator('.segmented-secret-text__glyph')).toHaveCount(ready.state.challenge.prompt.length);
      const lineLengths = await stage.locator('.segmented-secret-text__line').evaluateAll(lines => lines.map(line => line.querySelectorAll('.segmented-secret-text__glyph').length));
      if (ready.state.challenge.prompt.length > 18) expect(Math.max(...lineLengths) - Math.min(...lineLengths)).toBeLessThanOrEqual(6);
      await expect(stage.locator('.segmented-secret-text__word-gap, .segmented-secret-text__space')).toHaveCount(0);
      await expect(stage.locator('.segmented-secret-text__interference')).toHaveCount(0);
    }
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
      const movingComposite = stage.getByTestId('image-decoder-composite');
      await expect(movingComposite.getByTestId('image-decoder-subject')).toHaveCount(1);
      await expect(movingComposite.locator('.image-decoder-display__artifacts')).toHaveCount(1);
      const decoderCard = stage.locator('.image-decoder-display');
      const geometry = async () => decoderCard.evaluate(card => {
        const box = element => {
          const bounds = element.getBoundingClientRect();
          return {left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height};
        };
        return {card:box(card),subject:box(card.querySelector('.image-decoder-display__subject')),artifacts:box(card.querySelector('.image-decoder-display__artifacts'))};
      });
      const waitForNextSettledFrame = async () => {
        const startingIndex = await decoderCard.getAttribute('data-motion-index');
        await expect.poll(() => decoderCard.getAttribute('data-motion-index')).not.toBe(startingIndex);
        await page.waitForTimeout(50);
      };
      await waitForNextSettledFrame();
      const firstGeometry = await geometry();
      const firstIndex = Number(await decoderCard.getAttribute('data-motion-index'));
      const firstRotation = Number(await decoderCard.locator('.image-decoder-display__artifacts').getAttribute('data-interference-rotation'));
      const subject = movingComposite.getByTestId('image-decoder-subject');
      const firstSubjectFrame = await subject.evaluate(element => ({
        mirrored:element.dataset.mirrored,
        x:Number(element.dataset.subjectX), y:Number(element.dataset.subjectY),
        scale:Number(element.dataset.subjectScale), opacity:Number(element.dataset.subjectOpacity),
      }));
      expect(firstSubjectFrame.scale).toBeGreaterThanOrEqual(0.25);
      expect(firstSubjectFrame.scale).toBeLessThanOrEqual(0.75);
      expect(firstSubjectFrame.opacity).toBeGreaterThanOrEqual(0.25);
      expect(firstSubjectFrame.opacity).toBeLessThanOrEqual(1);
      expect(firstGeometry.subject.left).toBeGreaterThanOrEqual(firstGeometry.artifacts.left - 1);
      expect(firstGeometry.subject.top).toBeGreaterThanOrEqual(firstGeometry.artifacts.top - 1);
      expect(firstGeometry.subject.left + firstGeometry.subject.width).toBeLessThanOrEqual(firstGeometry.artifacts.left + firstGeometry.artifacts.width + 1);
      expect(firstGeometry.subject.top + firstGeometry.subject.height).toBeLessThanOrEqual(firstGeometry.artifacts.top + firstGeometry.artifacts.height + 1);
      expect(await movingComposite.locator('.image-decoder-display__artifact')).toHaveCount(140);
      expect(await movingComposite.locator('.image-decoder-display__texture-tile').first().getAttribute('width')).toBe('3');
      const transitionDurations = await decoderCard.evaluate(card => ({
        card:getComputedStyle(card).transitionDuration,
        subject:getComputedStyle(card.querySelector('.image-decoder-display__subject')).transitionDuration,
        artifacts:getComputedStyle(card.querySelector('.image-decoder-display__artifacts')).transitionDuration,
      }));
      expect(transitionDurations).toEqual({card:'0s',subject:'0s',artifacts:'0s'});
      await waitForNextSettledFrame();
      const secondGeometry = await geometry();
      const secondIndex = Number(await decoderCard.getAttribute('data-motion-index'));
      const secondRotation = Number(await decoderCard.locator('.image-decoder-display__artifacts').getAttribute('data-interference-rotation'));
      const secondSubjectFrame = await subject.evaluate(element => ({
        mirrored:element.dataset.mirrored,
        x:Number(element.dataset.subjectX), y:Number(element.dataset.subjectY),
      }));
      expect(Math.hypot(secondGeometry.card.left - firstGeometry.card.left, secondGeometry.card.top - firstGeometry.card.top)).toBeGreaterThanOrEqual(firstGeometry.card.width * 0.5);
      expect(secondIndex).toBe((firstIndex + 1) % 8);
      expect((secondRotation - firstRotation + 720) % 360).toBe(90);
      expect(secondSubjectFrame.mirrored).not.toBe(firstSubjectFrame.mirrored);
      expect(secondSubjectFrame.x).not.toBe(firstSubjectFrame.x);
      expect(secondSubjectFrame.y).not.toBe(firstSubjectFrame.y);
      expect(secondGeometry.subject.left).toBeGreaterThanOrEqual(secondGeometry.artifacts.left - 1);
      expect(secondGeometry.subject.top).toBeGreaterThanOrEqual(secondGeometry.artifacts.top - 1);
      expect(secondGeometry.subject.left + secondGeometry.subject.width).toBeLessThanOrEqual(secondGeometry.artifacts.left + secondGeometry.artifacts.width + 1);
      expect(secondGeometry.subject.top + secondGeometry.subject.height).toBeLessThanOrEqual(secondGeometry.artifacts.top + secondGeometry.artifacts.height + 1);
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
    await expectActionRail(/^(Go|Start acting)/i);
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
    if (turn === 0) {
      await page.keyboard.up('Enter');
      await page.keyboard.press('Escape');
      await phase('challenge-ready');
      const rewound = await read();
      expect(rewound.state.challenge_index).toBe(turn);
      expect(rewound.state.challenge.id).toBe(ready.state.challenge.id);
      expect(rewound.state.deadline).toBeNull();
      await focusRemote(/^(Go|Start acting)/i);
      await page.keyboard.press('Enter');
      await phase('performing');
    }
    await expect(stage.getByRole('list', {name:'Charades rules'})).toContainText('No talkingNo spellingNo pointing');
    await expect(stage).not.toContainText('Act it out');
    await expect(stage.getByRole('button', {name:'Finish turn'}).locator('svg')).toBeVisible();
    await expectActionRail(/finish|stop timer/i);
    const progress = stage.locator('.charades__countdown-progress');
    const initialOffset = await progress.evaluate(circle => circle.style.strokeDashoffset);
    await expect.poll(() => progress.evaluate(circle => circle.style.strokeDashoffset), {timeout:2500}).not.toBe(initialOffset);
    // Repeated keydowns from the same held remote button cannot end acting.
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await phase('performing');
    await page.keyboard.up('Enter');
    await expect.poll(async () => (await musicState()).some(a => !a.paused && a.time > 0.1 && a.ready >= 2), {timeout:20_000}).toBe(true);
    const playingTrack = (await musicState()).find(a => !a.paused)?.src;
    heardTracks.push(playingTrack);
    if (turn === 0) {
      const looped = await page.evaluate(url => {
        const audio = (window.__fheAudioElements || []).find(candidate => candidate.src === url);
        const loop = audio?.loop;
        audio?.dispatchEvent(new Event('ended'));
        return { loop, src: audio?.src };
      }, playingTrack);
      expect(looped).toEqual({ loop: true, src: playingTrack });
      await page.waitForTimeout(100);
      expect((await musicState()).find(a => !a.paused)?.src).toBe(playingTrack);
    }
    await expectFits(stage);
    if (turn === 0) await page.screenshot({path:testInfo.outputPath('acting.png')});
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
    await expect(stage).not.toContainText(/The clue was|Thanks for acting/);
    if (imageTurn) {
      const revealedImage = stage.getByRole('img', {name:ready.state.challenge.prompt,exact:true});
      await expect(revealedImage).toBeVisible();
      await expect(revealedImage).toHaveAttribute('src', ready.state.challenge.decoder.image);
      await expect.poll(() => revealedImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(stage.locator('.image-decoder-display')).toHaveCount(0);
    }
    await expectFits(stage);
    await expectActionRail(/Next clue|Next performer|Finish game/);
    if (turn === 0) await page.screenshot({path:testInfo.outputPath('reveal.png')});
    await expect(stage).not.toContainText(/score committed|guessed it|not guessed|wins/i);
    await expect(stage.getByRole('button', {name:/Next clue|Next performer|Finish game/}).locator('svg')).toBeVisible();
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
  expect(heardTracks).toHaveLength(18);
  expect(new Set(heardTracks).size).toBe(18);
  await expect(page.getByTestId('results')).toBeVisible();
  const heardCues = await page.evaluate(() => (window.__fheAudioElements || [])
    .map(audio => new URL(audio.src || '', location.origin).pathname)
    .filter(path => path.includes('/api/v1/gaming/media/charades/'))
    .map(path => path.split('/').pop()));
  expect(new Set(heardCues)).toEqual(new Set(['performer-selected.mp3','clue-revealed.mp3','acting-started.mp3','time-up.mp3','turn-finished.mp3','handoff.mp3','game-finished.mp3']));
  expect(await page.evaluate(() => (window.__fheAudioElements || [])
    .filter(audio => audio.src.includes('/api/v1/gaming/media/charades/'))
    .every(audio => audio.volume === 0.4))).toBe(true);
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
  expect(creations).toHaveLength(1);
  expect(pageErrors).toEqual([]);
  expect(gameFailures).toEqual([]);
  await testInfo.attach('verified-turns', {body:JSON.stringify({sessionId,turns,imageIds,textIds},null,2),contentType:'application/json'});
});
