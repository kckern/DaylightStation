import { test, expect } from '@playwright/test';
import { expectMenuGeometry, expectSelectedRowVisible, readMenuGeometry, readActionText, expectActionTextContained, expectContentTextContained } from '../../../_lib/skylineLayoutAssertions.mjs';

const sizes = [[1381, 777], [1920, 934], [1024, 600], [700, 1000]];
export const scenario = (page, patch) => page.evaluate(p => window.__skylineLayout.setScenario(p), patch);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', r => { throw new Error(`Unexpected API request: ${r.request().url()}`); });
  await page.goto('/'); await page.locator('body[data-ready="true"]').waitFor();
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('22px "SNES Mario Paint"'), document.fonts.load('22px "Press Start 2P"')]);
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.fonts.check('22px "SNES Mario Paint"') && document.fonts.check('22px "Press Start 2P"'))).toBe(true);
});
for (const game of ['glider', 'invaders']) for (const [width, height] of sizes) {
  test(`${game} five logical rows stay contained and selection remains reachable ${width}x${height} @shell-list`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await scenario(page, { game, screen: game === 'glider' ? 'flights' : 'waves', longText: true });
    const first = await readMenuGeometry(page);
    for (const selectedIndex of [0, 7, 13]) {
      await scenario(page, { selectedIndex });
      await expect(page.locator('.skyline-menus__options button')).toHaveCount(5);
      await expectMenuGeometry(page); await expectSelectedRowVisible(page);
      const next = await readMenuGeometry(page);
      expect(Math.abs(next.actionRegion.top - first.actionRegion.top)).toBeLessThanOrEqual(1);
    }
  });
}
test('host resize keeps selection visible @shell-list', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await scenario(page, { game: 'invaders', screen: 'waves', selectedIndex: 13, longText: true, host: { width: 1024, height: 600 } });
  await expectMenuGeometry(page); await expectSelectedRowVisible(page);
  await scenario(page, { host: { width: 700, height: 500 } });
  await expectMenuGeometry(page); await expectSelectedRowVisible(page);
});
test('delayed bundled fonts keep selection visible @shell-list', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 600 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/fonts/arcade/*', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__skylineLayout?.setScenario === 'function');
    await page.evaluate(() => { void window.__skylineLayout.setScenario({ selectedIndex: 13, longText: true }); });
    await page.locator('[data-row="a13"][aria-pressed="true"]').waitFor();
    release();
    await page.evaluate(async () => { await document.fonts.load('22px "SNES Mario Paint"'); await document.fonts.ready; });
    await expectSelectedRowVisible(page);
    await expectMenuGeometry(page);
  } finally { release(); await page.close(); }
});
test('an unrelated render does not recapture manual scroll @shell-list', async ({ page }) => {
  await scenario(page, { selectedIndex: 13, longText: true });
  await expectSelectedRowVisible(page);
  await page.locator('[data-skyline-scroll]').evaluate(e => { e.scrollTop = 0; });
  await scenario(page, { notice: 'Reading a notice must not drag the menu back to the chosen flight.' });
  expect((await readMenuGeometry(page)).scrollTop).toBe(0);
});
test('a new menu starts at its own heading instead of inheriting prior scroll @shell-list',async({page})=>{
  await page.setViewportSize({width:700,height:1000});
  await scenario(page,{game:'invaders',screen:'waves',longText:true,selectedIndex:13});
  await expectSelectedRowVisible(page);
  expect((await readMenuGeometry(page)).scrollTop).toBeGreaterThan(0);
  await scenario(page,{screen:'method',longText:false,methodCursor:0});
  expect((await readMenuGeometry(page)).scrollTop).toBe(0);
});
test('an oversized row exposes its start and can be read by scrolling @shell-list', async ({ page }) => {
  await scenario(page, { game: 'glider', screen: 'flights', longText: true, selectedIndex: 13, host: { width: 700, height: 500 } });
  await expectSelectedRowVisible(page);
  const g = await readMenuGeometry(page);
  expect(g.scrollHeight).toBeGreaterThan(g.clientHeight);
  await page.locator('[data-skyline-scroll]').evaluate(e => { e.scrollTop += 60; });
  expect((await readMenuGeometry(page)).scrollTop).toBeGreaterThan(g.scrollTop);
});
test('Tab reveals an offscreen row without document scrolling @shell-list', async ({ page }) => {
  await scenario(page, { longText: true, selectedIndex: 0, host: { width: 1024, height: 600 } });
  const last = page.locator('.skyline-menus__options button').last();
  await last.focus();
  await expect(last).toBeFocused();
  const bounds = await last.boundingBox(), g = await readMenuGeometry(page);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(g.content.bottom + 1);
  expect(g.document).toEqual(g.viewport);
});
for(const game of ['glider','invaders'])test(`${game} changed text reveals the unchanged selected row @review-fix`,async({page})=>{
  await page.setViewportSize({width:1024,height:600});
  await scenario(page,{game,screen:game==='glider'?'flights':'waves',selectedIndex:13,longText:false});
  await expectSelectedRowVisible(page);
  await scenario(page,{longText:true});
  await expectSelectedRowVisible(page);await expectMenuGeometry(page);
  await page.locator('[data-skyline-scroll]').evaluate(e=>{e.scrollTop=0;});
  await scenario(page,{notice:'Unrelated notice update'});
  expect((await readMenuGeometry(page)).scrollTop).toBe(0);
});
for(const height of [400,500])test(`short touch host keeps readable non-overlapping content at 700x${height} @review-fix`,async({page})=>{
  await scenario(page,{game:'invaders',screen:'waves',selectedIndex:13,host:{width:700,height}});
  const g=await readMenuGeometry(page);
  expect(g.content.height).toBeGreaterThanOrEqual(128);
  expect(g.content.bottom).toBeLessThanOrEqual(g.actionRegion.top+1);
  expect(g.actionRegion.bottom).toBeLessThanOrEqual(g.utility.top+1);
  expect(await page.locator('.skyline-menu-layout__actions').evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  const exit=page.locator('.skyline-menu-layout__actions [data-position="6"]');await exit.focus();
  const r=await exit.boundingBox(),after=await readMenuGeometry(page);
  expect(r.y).toBeGreaterThanOrEqual(after.actionRegion.top-1);
  expect(r.y+r.height).toBeLessThanOrEqual(after.actionRegion.bottom+1);
  await expectMenuGeometry(page);
});

for (const [width, height] of sizes) {
  test(`Retry checkpoint stays inside its button ${width}x${height} @actions`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await scenario(page, { game: 'glider', screen: 'crash' });
    await expectActionTextContained(page); await expectMenuGeometry(page);
  });
  test(`open and locked waves keep action anchors ${width}x${height} @actions`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await scenario(page, { game: 'invaders', screen: 'waves', selectedIndex: 1 });
    const before = await readActionText(page);
    await expectActionTextContained(page);
    await scenario(page, { selectedIndex: 2 });
    await expectActionTextContained(page);
    const after = await readActionText(page);
    for (const b of before.buttons.filter(b => Number(b.position) <= 4)) {
      const next = after.buttons.find(a => a.position === b.position);
      for (const k of ['top', 'bottom', 'height']) expect(Math.abs(b.box[k] - next.box[k])).toBeLessThanOrEqual(1);
      expect(Math.abs(b.label.top - next.label.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.hint.top - next.hint.top)).toBeLessThanOrEqual(1);
    }
  });
  for (const game of ['glider', 'invaders']) test(`${game} saving error and saved keep action anchors ${width}x${height} @actions`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await scenario(page, { game, screen: 'result', selectedIndex: 13, saveStatus: 'saving' });
    const before = await readActionText(page);
    const areaBefore = (await readMenuGeometry(page)).actionRegion;
    for (const saveStatus of ['error', 'saved']) {
      await scenario(page, { saveStatus, notice: 'This attempt could not be saved. You can still choose what happens next. '.repeat(5) });
      await expectActionTextContained(page); await expectMenuGeometry(page);
      const after = await readActionText(page);
      const areaAfter = (await readMenuGeometry(page)).actionRegion;
      expect(Math.abs(areaAfter.top - areaBefore.top)).toBeLessThanOrEqual(1);
      for (const b of before.buttons.filter(b => Number(b.position) <= 4)) {
        const next = after.buttons.find(a => a.position === b.position);
        expect(Math.abs(b.box.top - next.box.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.label.top - next.label.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.hint.top - next.hint.top)).toBeLessThanOrEqual(1);
      }
    }
  });
}
test('multiline reasons and notices do not cover controls under reduced motion @actions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1381, height: 777 });
  await scenario(page, { game: 'glider', screen: 'denied', notice: 'The school check is offline. A grown-up can unlock. '.repeat(5) });
  await expectActionTextContained(page); await expectMenuGeometry(page);
});

for (const [width, columns] of [[1381,3], [1920,3], [1101,3], [1100,2], [1024,2], [761,2], [760,1], [700,1]]) {
  test(`methods reflow at host ${width}px to ${columns} columns @methods`, async ({ page }) => {
    await page.setViewportSize({width:1920,height:1080});
    await scenario(page, { game: 'invaders', screen: 'method', host: { width, height: 777 }, currentMethod: 'wheel', methodCursor: 3 });
    expect(await page.locator('.skyline-invaders__methods').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(columns);
    await expectMenuGeometry(page);
  });
}
for (const [width,height] of sizes) test(`Steering wheel and Yours have disjoint glyph bounds ${width}x${height} @methods`, async ({ page }) => {
  await page.setViewportSize({width,height});
  await scenario(page, {game:'invaders',screen:'method',currentMethod:'wheel',methodCursor:3});
  const tile=page.getByTestId('invaders-method-wheel');
  const geometry=await tile.evaluate(e=>{
    const rects = node => {const range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));};
    const r=e.getBoundingClientRect();return {tile:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},label:rects(e.querySelector('strong')),marker:rects(e.querySelector('small'))};
  });
  for(const r of [...geometry.label,...geometry.marker]) {
    expect(r.left).toBeGreaterThanOrEqual(geometry.tile.left-1);expect(r.right).toBeLessThanOrEqual(geometry.tile.right+1);
    expect(r.top).toBeGreaterThanOrEqual(geometry.tile.top-1);expect(r.bottom).toBeLessThanOrEqual(geometry.tile.bottom+1);
  }
  for(const a of geometry.label)for(const b of geometry.marker)expect(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1).toBe(false);
});
test('every method is reachable after scrolling and resizing @methods', async ({page})=>{
  await scenario(page,{game:'invaders',screen:'method',methodCursor:0,host:{width:700,height:600}});
  for(let i=0;i<7;i++)await page.keyboard.press('ArrowRight');
  const last=page.getByTestId('invaders-method-hop');
  await expect(last).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>{const r=await last.boundingBox(),g=await readMenuGeometry(page);return r.y>=g.content.top-1&&r.y+r.height<=g.content.bottom+1;}).toBe(true);
  await scenario(page,{host:{width:1101,height:777}});
  await expect(last).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>window.__skylineLayout.actions.at(-1))).toEqual({type:'method',value:'hop'});
});
test('long people names stay in their tiles without a nested scroller @methods',async({page})=>{
  await scenario(page,{game:'invaders',screen:'roster',longText:true,host:{width:700,height:600}});
  const people=page.locator('.skyline-invaders__people');
  expect(await people.evaluate(e=>getComputedStyle(e).overflowY)).toBe('visible');
  const tile=page.getByTestId('invaders-person-r3');await tile.focus();
  const contained=await tile.evaluate(e=>{const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e.querySelector('strong'));return [...range.getClientRects()].every(t=>t.left>=r.left-1&&t.right<=r.right+1&&t.top>=r.top-1&&t.bottom<=r.bottom+1);});
  expect(contained).toBe(true);await expectMenuGeometry(page);
});
test('multiline action text fits at DPR 1.39 @actions', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1381, height: 777 }, deviceScaleFactor: 1.39 });
  const page = await context.newPage();
  try {
    await page.goto('/'); await page.locator('body[data-ready="true"]').waitFor();
    await scenario(page, { game: 'glider', screen: 'crash' });
    await expectActionTextContained(page);
  } finally { await context.close(); }
});

// 2026-11-17 kiosk screenshot: the names sat on top of the avatars, the cards
// filled a third of the screen and the same hold hint was printed three times.
test('rider picker cards keep each name clear of its avatar and fill the screen @identity', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1810, height: 1080 });
  await scenario(page, { game: 'glider', screen: 'identity', longText: false, host: null, notice: '' });
  await page.waitForFunction(() => [...document.querySelectorAll('.skyline-controls img')].every(i => i.complete));
  const g = await page.evaluate(() => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return {
      layout: box(document.querySelector('.skyline-menu-layout')), pad: box(document.querySelector('.skyline-controls__pad')),
      window: box(document.querySelector('.skyline-menus--identity')), controls: box(document.querySelector('.skyline-controls')),
      viewport: { width: innerWidth, height: innerHeight }, document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      cards: [...document.querySelectorAll('.skyline-controls__pad button')].map(b => ({
        card: box(b), img: box(b.querySelector('img')), name: box(b.querySelector('strong')), badge: box(b.querySelector('.skyline-controls__position')),
        hint: b.querySelector('.skyline-controls__hint').textContent,
      })),
      everything: [...document.querySelectorAll('.skyline-menu-layout *')].filter(e => e.getClientRects().length).map(box),
    };
  });
  await page.screenshot({ path: testInfo.outputPath('glider-identity-1810.png') });
  const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  expect(g.cards).toHaveLength(4);
  for (const c of g.cards) {
    expect(c.img.height).toBeGreaterThan(0);
    expect(overlaps(c.img, c.name)).toBe(false);
    expect(inside(c.name, c.card)).toBe(true);
    expect(inside(c.badge, c.card)).toBe(true);
    expect(inside(c.img, c.card)).toBe(true);
  }
  expect(g.cards.map(c => c.hint)).toEqual(['', 'Hold for Grown-up', '', '']);
  expect(g.pad.height).toBeGreaterThanOrEqual(0.4 * g.layout.height);
  // Neither half may leave a dead block of sky (review of the 2026-11-24 fix:
  // the title window sat at the top of an otherwise empty left half).
  for (const column of [g.window, g.controls]) {
    expect(column.top - g.layout.top).toBeLessThanOrEqual(0.4 * g.layout.height);
    expect(g.layout.bottom - column.bottom).toBeLessThanOrEqual(0.4 * g.layout.height);
  }
  expect(g.document).toEqual([g.viewport.width, g.viewport.height]);
  for (const r of g.everything) expect(inside(r, { left: 0, top: 0, right: g.viewport.width, bottom: g.viewport.height })).toBe(true);
  await expectMenuGeometry(page);
});

const screenMatrix = {
  glider: ['identity','roster','flights','ready','countdown','menu','settings','crash','result','save-details','denied','loading','error'],
  invaders: ['who','roster','waves','method','sweep','locked','ready','paused','result','sound','loading','error'],
};
for(const game of Object.keys(screenMatrix))for(const [width,height]of sizes)test(`${game} every menu screen stays usable ${width}x${height} @matrix`,async({page},testInfo)=>{
  await page.setViewportSize({width,height});
  for(const screen of screenMatrix[game]){
    await scenario(page,{game,screen,longText:false,selectedIndex:1,host:null,saveStatus:'saved',notice:screen==='result'?'Flight saved · +3 rings':''});
    await expectMenuGeometry(page);await expectActionTextContained(page);await expectContentTextContained(page);
    if(game==='invaders'&&width>=1381){
      const small=await page.locator('.skyline-menus').evaluate(e=>{const t=document.createElement('span');t.style.fontSize='var(--sg-text-s)';e.append(t);const size=parseFloat(getComputedStyle(t).fontSize);t.remove();return size;});
      expect(small).toBeGreaterThanOrEqual(22);
    }
    if(['flights','waves','method','save-details','result'].includes(screen))await page.screenshot({path:testInfo.outputPath(`${game}-${screen}-${width}.png`)});
  }
});
