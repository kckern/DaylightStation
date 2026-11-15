#!/usr/bin/env node
/** Real rewards components/styles, synthetic read-only APIs, no household traffic. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as sass from 'sass';
import { chromium } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = mkdtempSync(join(tmpdir(), 'school-rewards-'));
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import RewardsChest from './__app_modules/learning/school/browser/rewards/RewardsChest.jsx';
import RewardsModal from './__app_modules/learning/school/browser/rewards/RewardsModal.jsx';
const snapshot = id => ({ learnerId:id, week:'2026-11-09', mode:'live', silver:24, gold:3, rings:1260,
 groups:[{id:'move',label:'Move'},{id:'school',label:'School'},{id:'games',label:'Games'}],
 gems:Array.from({length:13},(_,index)=>({id:'gem-'+index,label:['Moved 5 days','Most rings','Green week','Reading','Piano'][index%5],group:['move','school','games'][index%3],color:['#1e88e5','#f2c94c','#2e9e5b'][index%3],cell:{state:index%3?'pending':'earned',week:index%3?0:1,streak:index%3?{have:3,need:4,reach:'on-track'}:null,parts:[]}})) });
function Fixture(){
 const [kid,setKid]=useState(null);
 return <main style={{padding:24}}><h1>Today at school</h1>{['Alex','Jamie'].map(name => <div key={name} style={{display:'flex',gap:32,alignItems:'center'}}><span>{name}</span><div style={{width:160,height:160}}><RewardsChest name={name} onOpen={()=>setKid({id:name.toLowerCase(),name})}/></div></div>)}{kid&&<RewardsModal key={kid.id} learner={kid} snapshot={snapshot(kid.id)} onClose={()=>setKid(null)} onOpenBank={()=>setKid(null)} />}</main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const bundle = await build({
  stdin: { contents: entry, loader: 'jsx', resolveDir: repo }, jsx: 'automatic', bundle: true, write: false,
  outdir: '/fixture', format: 'iife', nodePaths: [join(repo, 'frontend/node_modules')],
  alias: { '@': join(repo, 'frontend/src'), react: join(repo, 'frontend/node_modules/react'), 'react-dom': join(repo, 'frontend/node_modules/react-dom') },
  define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.svg': 'dataurl' }, logLevel: 'silent',
  plugins: [{ name: 'rewards-fixture', setup(builder) {
    builder.onResolve({ filter: /\.svg\?url$/ }, args => ({ path: resolve(dirname(args.importer), args.path.replace('?url', '')) }));
    builder.onResolve({ filter: /schoolLog\.js$/ }, () => ({ path: 'logger', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const schoolLog={selfService(){},selfServiceError(){}};' }));
    builder.onLoad({ filter: /\.scss$/ }, ({ path }) => ({ contents: sass.compile(path).css, loader: 'css' }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(js); }
  if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#101b26;color:#eef3f6;font-family:system-ui}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const evidence = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.startsWith('/api/v1/static/img/users/')) return route.fulfill({ status: 404, body: 'No fixture avatar' });
    let data;
    if (url.pathname.includes('/preview/')) data = { learnerId: url.pathname.split('/').at(-1), totals: { silver: 24 }, lines: [] };
    else if (url.pathname.endsWith('/bank')) data = { mode: 'live', balances: { silver: 15, gold: 3 } };
    else if (url.pathname.endsWith('/gems')) {
      const categories = Array.from({ length: 24 }, (_, index) => ({ id: `gem-${index}`, label: `Reading achievement ${index + 1}`, color: '#82c5b8' }));
      data = { mode: 'live', learners: [{ learnerId: 'alex', name: 'Alex' }, { learnerId: 'jamie', name: 'Jamie' }], categories,
        cells: Object.fromEntries(categories.map(category => [category.id, { alex: { state: 'pending', week: 0, parts: [{ ruleId: 'reader', label: 'Story time', state: 'pending', progress: { have: 3, need: 4 }, reach: 'on-track' }] }, jamie: { state: 'earned', week: 99, parts: [] } }])) };
    } else throw Error(`Unexpected API call: ${url.pathname}`);
    return route.fulfill({ json: data });
  });
  for (const [width, height] of [[1280, 800], [320, 568], [390, 844], [667, 375], [820, 450], [1024, 600], [1920, 1080], [320, 256]]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(origin);
    const door = page.getByRole('button', { name: "Open Alex's rewards" });
    assert.equal(await door.textContent(), '');
    const doorBox = await door.boundingBox();
    const chestBox = await door.locator('.school-rewards-chest').boundingBox();
    assert.ok(chestBox.width >= doorBox.width * .9 && chestBox.height >= doorBox.height * .9, 'chest fills its cell');
    await page.mouse.move(doorBox.x + doorBox.width/2, doorBox.y + doorBox.height/2);
    await page.mouse.down();
    assert.ok((await door.getAttribute('class')).includes('is-opening'), 'starts before release');
    await page.mouse.up();
    assert.equal(await page.getByRole('dialog').count(), 0, 'modal waits for opening');
    const modal = page.getByRole('dialog', { name: "Alex's rewards" });
    await modal.waitFor({ state: 'visible' }); await modal.getByText('24', { exact: true }).waitFor();
    const geometry = await modal.evaluate(el => {
      const r = el.getBoundingClientRect(), close = el.querySelector('.school-rewards-modal__close').getBoundingClientRect(), body = el.querySelector('.school-rewards-modal__grid-box');
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, closeTop: close.top, closeBottom: close.bottom, bodyOverflow: body.scrollWidth > body.clientWidth, documentOverflow: document.documentElement.scrollWidth > innerWidth, scrolls: el.scrollHeight > el.clientHeight || body.scrollHeight > body.clientHeight, gems: el.querySelectorAll('.gem-glyph').length, gemWidth: el.querySelector('.gem-glyph')?.getBoundingClientRect().width };
    });
    assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= width + .5 && geometry.bottom <= height + .5, JSON.stringify(geometry));
    assert.ok(geometry.closeTop >= 0 && geometry.closeBottom <= height, 'close visible');
    assert.ok(!geometry.bodyOverflow && !geometry.documentOverflow, 'no horizontal overflow');
    assert.ok(!geometry.scrolls, 'all rewards fit in one view');
    assert.equal(geometry.gems, 13);
    if(width===1280) assert.ok(geometry.gemWidth>=80, 'large gems on the Portal');
    const bankBox=await modal.getByRole('button',{name:'Bank log'}).boundingBox();
    assert.ok(bankBox.y+bankBox.height<=height, 'bank link visible without scrolling');
    const fitting=await modal.locator('.school-rewards-modal__grid').evaluate(el=>{const p=el.parentElement.getBoundingClientRect(),r=el.getBoundingClientRect();return r.width<=p.width+.5&&r.height<=p.height+.5});
    assert.ok(fitting, 'glyph grid is not clipped');
    assert.ok(!(await modal.textContent()).includes('Jamie'), 'only own data');
    await page.screenshot({ path: join(outDir, `${width}x${height}.png`) });

    // The title/close control stays visible after scrolling the rewards.
    const close = await modal.getByRole('button', { name: 'Close rewards' }).boundingBox();
    assert.ok(close.y >= 0 && close.y + close.height <= height);
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
    assert.ok(await door.evaluate(el => el === document.activeElement), 'focus returns to chest');
    evidence.push({ width, height, ...geometry });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: "Open Jamie's rewards" }).click();
  await page.getByRole('dialog', { name: "Jamie's rewards" }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.getByRole('button', { name: 'Close rewards' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  writeFileSync(join(outDir, 'geometry.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.length, reducedMotion: true, keyboard: true, focusRestoration: true, outDir }));
} finally {
  await browser.close(); await new Promise(r => server.close(r));
}
