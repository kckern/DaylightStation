import { test, expect } from '@playwright/test';
const tvPath = id => `/screens/living-room/party-games/${id}`;
const teams = [{
  id: 'red',
  name: 'Readers of Judah',
  color: '#3273dc',
  members: [{
    id: 'guest-red',
    name: 'Reader'
  }]
}, {
  id: 'gold',
  name: 'Gold Explorers',
  color: '#e6b325',
  members: [{
    id: 'guest-gold',
    name: 'Explorer'
  }]
}, {
  id: 'green',
  name: 'Young Prophets',
  color: '#369768',
  members: [{
    id: 'guest-green',
    name: 'Youngster'
  }]
}];
async function json(response) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function geometry(page, selectors) {
  const result = await page.evaluate(selectors => {
    const boxes = selectors.map(s => {
      const e = document.querySelector(s);
      if (!e) throw new Error(`Missing ${s}`);
      const r = e.getBoundingClientRect();
      return {
        s,
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        scroll: e.scrollHeight,
        client: e.clientHeight
      };
    });
    return {
      boxes,
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight
    };
  }, selectors);
  expect(result.overflow).toBe(false);
  for (const b of result.boxes) {
    expect(b.x, b.s).toBeGreaterThanOrEqual(0);
    expect(b.y, b.s).toBeGreaterThanOrEqual(0);
    expect(b.right, b.s).toBeLessThanOrEqual(result.width + 1);
    expect(b.bottom, b.s).toBeLessThanOrEqual(result.height + 1);
    expect(b.scroll, b.s).toBeLessThanOrEqual(b.client + 1);
  }
  for (let i = 0; i < result.boxes.length; i++) for (let j = i + 1; j < result.boxes.length; j++) {
    const a = result.boxes[i],
      b = result.boxes[j];
    expect(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, `${a.s} overlaps ${b.s}`).toBeTruthy();
  }
}
async function tileGeometry(host) {
  const boxes = await host.locator('.gp-host__tile').evaluateAll(es => es.map(e => {
    const r = e.getBoundingClientRect();
    return {
      height: r.height,
      top: r.top
    };
  }));
  expect(boxes).toHaveLength(15);
  for (const b of boxes) expect(b.height).toBe(boxes[0].height);
  for (let row = 0; row < 3; row++) for (let cat = 0; cat < 5; cat++) expect(boxes[cat * 3 + row].top).toBe(boxes[row].top);
  return boxes;
}
for (const definitionId of ['jeopardy:fhe-jeremiah', 'jeopardy:practice-isaiah']) test(`${definitionId}: two pages complete real host flow and restart`, async ({
  page,
  context,
  request
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({
    width: 960,
    height: 540
  });
  const host = await context.newPage();
  await host.setViewportSize({
    width: 390,
    height: 844
  });
  const ids = [];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  host.on('pageerror', e => errors.push(e.message));
  let id;
  const get = () => request.get(`/api/v1/gaming/sessions/${encodeURIComponent(id)}`).then(json);
  const phase = async p => {
    await expect(host.locator('.gp-host')).toHaveAttribute('data-phase', p);
    if (p === 'done') await expect(page.getByTestId('results')).toBeVisible();else await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase', p);
  };
  const click = async name => {
    const command = ['Start game', 'Start round', 'Lock wager', 'Reveal answer', 'Correct ✓', 'Back to board', 'Continue'].includes(name) ? host.waitForResponse(r => r.url().endsWith('/commands') && r.request().method() === 'POST') : null;
    await host.getByRole('button', {
      name,
      exact: true
    }).click();
    if (command) await command;
  };
  const selectAt = async (cat, row) => {
    const selected = host.waitForResponse(r => r.url().endsWith('/commands'));
    await host.locator('.gp-host__col').nth(cat).locator('.gp-host__tile').nth(row).click();
    await selected;
  };
  const restart = async ({ requirePlayed = false } = {}) => {
    const prior = await get();
    if (requirePlayed) {
      expect(prior.state.phase).toBe('clue');
      expect(Object.values(prior.state.scores).some(score => score > 0)).toBe(true);
      expect(Object.values(prior.state.used).some(Boolean)).toBe(true);
      expect(prior.state.isDailyDouble).toBe(true);
      expect(prior.state.wager).toBeGreaterThan(0);
    }
    await click('Restart game');
    await click('Cancel');
    const cancelled = await get();
    expect(cancelled.header.revision).toBe(prior.header.revision);
    expect(cancelled.state).toEqual(prior.state);
    await phase(prior.state.phase);
    if (requirePlayed) {
      for (const team of teams) {
        await expect(page.getByLabel(`${team.name} score`)).toHaveText(prior.state.scores[team.id].toLocaleString());
        await expect(host.locator('.gp-host__score').filter({hasText: team.name})).toContainText(`${team.name} ${prior.state.scores[team.id].toLocaleString()}`);
      }
      await page.screenshot({animations:'disabled',path:test.info().outputPath('active-restart-before-tv.png')});
      await host.screenshot({animations:'disabled',path:test.info().outputPath('active-restart-before-host.png')});
    }
    await click('Restart game');
    const response = host.waitForResponse(r => r.url().endsWith('/restart') && r.request().method() === 'POST');
    await click('Confirm restart');
    const fresh = await json(await response);
    id = fresh.header.session_id;
    ids.push(id);
    await phase('round-intro');
    expect(fresh.header.seats).toEqual(teams);
    expect(fresh.state.scores).toEqual({
      red: 0,
      gold: 0,
      green: 0
    });
    expect(fresh.state.used).toEqual({});
    expect(fresh.state.finalWagers).toEqual({});
    expect(fresh.state.finalJudged).toEqual({});
    expect(fresh.state.active).toBeNull();
    expect(fresh.state.wager).toBeNull();
    expect(fresh.state.isDailyDouble).toBe(false);
    expect(id).not.toBe(prior.header.session_id);
    expect(new URL(host.url()).pathname).toBe(`/party-games/host/${encodeURIComponent(id)}`);
    for (const team of teams) {
      await expect(page.getByLabel(`${team.name} score`)).toHaveText('0');
      await expect(host.locator('.gp-host__score').filter({hasText: team.name})).toContainText(`${team.name} 0`);
    }
    const preserved = await json(await request.get(`/api/v1/gaming/sessions/${encodeURIComponent(prior.header.session_id)}`));
    expect(preserved.state).toEqual(prior.state);
    expect(preserved.header.revision).toBe(prior.header.revision);
    if (requirePlayed) {
      await page.screenshot({animations:'disabled',path:test.info().outputPath('active-restart-after-tv.png')});
      await host.screenshot({animations:'disabled',path:test.info().outputPath('active-restart-after-host.png')});
    }
    expect(fresh.diagnostic.ephemeral).toBe(true);
    expect(new URL(page.url()).searchParams.get('diagnostic_session')).toBe(id);
  };
  try {
    const created = await json(await request.post('/api/v1/gaming/diagnostics/sessions', {
      data: {
        definition_id: definitionId,
        surface_id: 'party-games',
        seats: teams,
        setup: {
          teams,
          seats: teams
        }
      }
    }));
    id = created.header.session_id;
    ids.push(id);
    await page.goto(`${tvPath(definitionId)}?diagnostic_session=${encodeURIComponent(id)}`);
    await host.goto(`/party-games/host/${encodeURIComponent(id)}`);
    await phase('round-intro');
    const qr = page.getByTestId('host-lobby').getByRole('img');
    await expect(qr).toBeVisible();
    const qrBox = await qr.boundingBox();
    expect(qrBox.width).toBeGreaterThanOrEqual(180);
    expect(qrBox.height).toBeGreaterThanOrEqual(180);
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('lobby-960.png')
    });
    // Establish real in-progress state: score/use one clue, then lock a DD wager.
    await click('Start game');
    await phase('board');
    await selectAt(0, 0);
    await phase('clue');
    await click('Reveal answer');
    await phase('judging');
    await click('Correct ✓');
    await phase('board');
    const scored = (await get()).state;
    expect(scored.scores.red).toBe(100);
    expect(scored.used['0:0:0']).toBe(true);
    const dailyDouble = scored.set.rounds[0].categories.flatMap((category, cat) =>
      category.clues.map((clue, row) => ({clue, cat, row}))).find(cell => cell.clue.daily_double);
    expect(dailyDouble).toBeDefined();
    await selectAt(dailyDouble.cat, dailyDouble.row);
    await phase('wager');
    await click('Lock wager');
    await phase('clue');
    await restart({ requirePlayed: true });
    // A real host request fails once; Retry reloads and the next phone tap commits.
    await host.route('**/commands', route => route.fulfill({
      status: 503,
      json: {
        message: 'Acceptance transient failure'
      }
    }), {
      times: 1
    });
    await click('Start game');
    await expect(host.getByText('Controller unavailable')).toBeVisible();
    await click('Retry');
    await click('Start game');
    await phase('board');
    await expect(page.getByRole('img', {
      name: /Scan/
    })).toHaveCount(0);
    expect(await page.locator('.party-games__companion-rail').count()).toBe(0);
    await geometry(page, ['.gp-show-header', '[data-testid="jeopardy-board"]', '[data-testid="scoreboard"]']);
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('board-960.png')
    });
    await expect(host.locator('.gp-host__tile.is-used')).toHaveCount(0);
    await expect(page.locator('.jp-board__tile.is-used')).toHaveCount(0);
    let baseline = await tileGeometry(host);
    let dd = 0;
    const expected = {
      red: 0,
      gold: 0,
      green: 0
    };
    for (let roundIndex = 0; roundIndex < 2; roundIndex++) {
      if (roundIndex) {
        await click('Start round');
        await phase('board');
        baseline = await tileGeometry(host);
      }
      for (let cat = 0; cat < 5; cat++) for (let row = 0; row < 3; row++) {
        const before = (await get()).state;
        const clue = before.set.rounds[roundIndex].categories[cat].clues[row];
        await selectAt(cat, row);
        let current = (await get()).state;
        if (current.phase === 'wager') {
          dd++;
          await phase('wager');
          await page.screenshot({
            animations: 'disabled',
            path: test.info().outputPath(`wager-${dd}.png`)
          });
          await click('Lock wager');
          current = (await get()).state;
        }
        await phase('clue');
        await expect(page.getByTestId('scripture-reference')).toHaveText(`Look up: ${clue.scripture_reference}`);
        await expect(page.locator('.gp-reveal__answer')).toHaveCount(0);
        expect(current.answeringTeamId).toBe(before.turnTeamId);
        const revision = (await get()).header.revision;
        await page.keyboard.press('Enter');
        for (const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) await page.keyboard.press(key);
        await page.getByTestId('clue-screen').click();
        expect((await get()).header.revision).toBe(revision);
        if (cat === 0 && row === 0) {
          await host.reload();
          await page.reload();
          await phase('clue');
        }
        if (clue.media) {
          await expect(page.locator('.gp-media')).toBeVisible();
          await page.screenshot({
            animations: 'disabled',
            path: test.info().outputPath(`image-${roundIndex}-${cat}.png`)
          });
        }
        await click('Reveal answer');
        await phase('judging');
        await expect(page.locator('.gp-reveal__answer')).toHaveText(clue.answer);
        await geometry(page, ['.gp-reveal__prompt', '[data-testid="scripture-reference"]', '.gp-reveal__answer', '[data-testid="scoreboard"]']);
        if (cat === 0 && row === 0) await page.screenshot({
          animations: 'disabled',
          path: test.info().outputPath(`revealed-${roundIndex}.png`)
        });
        expected[current.answeringTeamId] += current.isDailyDouble ? current.wager : clue.value * (roundIndex + 1);
        await click('Correct ✓');
        const after = (await get()).state;
        expect(after.turnTeamId).toBe(teams[(teams.findIndex(team => team.id === before.turnTeamId)+1)%teams.length].id);
        expect(after.scores).toEqual(expected);
        for (const t of teams) {
          await expect(host.locator('.gp-host__score').filter({
            hasText: t.name
          })).toContainText(expected[t.id].toLocaleString());
          if (after.phase === 'board') await expect(page.getByLabel(`${t.name} score`)).toHaveText(expected[t.id].toLocaleString());
        }
        if (after.phase === 'board') {
          await phase('board');
          expect(await tileGeometry(host)).toEqual(baseline);
          if (cat === 0 && row === 0) await host.screenshot({
            animations: 'disabled',
            path: test.info().outputPath(`host-mixed-${roundIndex}.png`)
          });
        }
      }
    }
    expect(dd).toBe(2);
    await phase('final-category');
    await expect(page.getByTestId('scripture-reference')).toHaveCount(0);
    await click('Continue');
    await phase('final-wager');
    await expect(page.getByTestId('scripture-reference')).toHaveCount(0);
    for (const t of teams) await click('Lock wager');
    await phase('final-clue');
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('final.png')
    });
    await click('Reveal answer');
    await phase('final-judging');
    const final = (await get()).state;
    await expect(page.getByTestId('scripture-reference')).toHaveText(`Look up: ${final.set.final.scripture_reference}`);
    for (const t of teams) {
      expected[t.id] += final.finalWagers[t.id];
      await host.getByRole('button', {
        name: 'Correct',
        exact: true
      }).first().click();
    }
    await phase('done');
    await expect(page.getByRole('button', {name:'Play another game'})).toHaveCount(0);
    expect((await get()).state.scores).toEqual(expected);
    for (const t of teams) await expect(page.getByTestId('results').locator('li').filter({
      hasText: t.name
    })).toContainText(expected[t.id].toLocaleString());
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('results.png')
    });
    await restart();
    expect(errors).toEqual([]);
  } finally {
    for (const sessionId of ids) expect((await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(sessionId)}`)).ok()).toBe(true);
    await host.close();
  }
});
for (const width of [960, 1920]) test(`TV containment at ${width}`, async ({
  page,
  request
}) => {
  await page.setViewportSize({
    width,
    height: width * 9 / 16
  });
  const created = await json(await request.post('/api/v1/gaming/diagnostics/sessions', {
    data: {
      definition_id: 'jeopardy:fhe-jeremiah',
      surface_id: 'party-games',
      seats: teams,
      setup: {
        teams,
        seats: teams
      }
    }
  }));
  const id = created.header.session_id;
  const clue = {
    value: 300,
    clue: 'The Lord promised Jeremiah that even when the people fought against him, they would not overcome him because the Lord would be with him and do this. Read the passage carefully and explain the promise in your own words.',
    answer: 'What is rescue him and keep him safe?',
    scripture_reference: 'Jeremiah 1:17–19; Jeremiah 15:20–21 (the Lord’s promise to Jeremiah)'
  };
  const patch = patch => request.patch(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}/state`, {
    data: {
      patch
    }
  }).then(json);
  try {
    await page.goto(`${tvPath('jeopardy:fhe-jeremiah')}?diagnostic_session=${encodeURIComponent(id)}`);
    await expect(page.getByTestId('host-lobby')).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath(`lobby-${width}.png`)
    });
    for (const variant of ['text', 'image', 'error', 'final']) {
      await patch({
        phase: variant === 'final' ? 'final-judging' : 'judging',
        scores: {
          red: -1200,
          gold: 2500,
          green: 500
        },
        revealed: true,
        answeringTeamId: 'red',
        active: {
          cat: 0,
          row: 0,
          clue: {
            ...clue,
            ...(['image', 'error'].includes(variant) ? {
              media: {
                type: 'image',
                src: variant === 'error' ? 'missing.svg' : 'jeremiah/potter.svg'
              }
            } : {})
          }
        },
        ...(variant === 'final' ? {
          set: {
            final: clue
          },
          finalWagers: {
            red: 100,
            gold: 200,
            green: 300
          }
        } : {})
      });
      await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase', variant === 'final' ? 'final-judging' : 'judging');
      if (variant === 'error') await expect(page.locator('.jp-clue__media-error')).toBeVisible();
      if (variant === 'image') await expect(page.locator('.gp-media')).toBeVisible();
      await geometry(page, ['.gp-reveal__prompt', '[data-testid="scripture-reference"]', '.gp-reveal__answer', '[data-testid="scoreboard"]', ...(variant === 'image' ? ['.gp-media'] : [])]);
      await page.screenshot({
        animations: 'disabled',
        path: test.info().outputPath(`${variant}-${width}.png`)
      });
    }
  } finally {
    expect((await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}`)).ok()).toBe(true);
  }
});

test('Isaiah preview route creates a fresh ephemeral game and phone host', async ({page,context,request}) => {
  await page.setViewportSize({width:960,height:540});
  await page.goto(tvPath('jeopardy:practice-isaiah'));
  await expect(page.getByTestId('team-setup')).toBeVisible();
  const creation = page.waitForResponse(r => r.url().endsWith('/gaming/sessions') && r.request().method() === 'POST');
  await page.getByTestId('teams-confirm').click();
  const session = await json(await creation);
  const id = session.header.session_id;
  expect(id).toMatch(/^diagnostic:/);
  const host = await context.newPage();
  try {
    await expect(page.getByTestId('host-lobby')).toBeVisible();
    await host.goto(`/party-games/host/${encodeURIComponent(id)}`);
    await host.getByRole('button',{name:'Start game',exact:true}).click();
    await expect(page.getByTestId('jeopardy-board')).toBeVisible();
    expect(session.diagnostic.ephemeral).toBe(true);
  } finally {
    await host.close();
    expect((await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}`)).ok()).toBe(true);
  }
});
