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
function Fixture(){
 const [kid,setKid]=useState(null);
 return <main style={{padding:24}}><h1>Today at school</h1>{['Alex','Jamie'].map(name => <div key={name} style={{display:'flex',gap:32,alignItems:'center'}}><span>{name}</span><RewardsChest name={name} onOpen={()=>setKid({id:name.toLowerCase(),name})}/></div>)}{kid&&<RewardsModal key={kid.id} learner={kid} onClose={()=>setKid(null)} onOpenBank={()=>setKid(null)} />}</main>;
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
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const schoolLog={selfServiceError(){}};' }));
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
  for (const [width, height] of [[320, 568], [390, 844], [667, 375], [820, 450], [1024, 600], [1920, 1080], [320, 256]]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(origin);
    const door = page.getByRole('button', { name: "Open Alex's rewards" });
    assert.equal(await door.textContent(), '');
    await door.click();
    assert.equal(await page.getByRole('dialog').count(), 0, 'modal waits for opening');
    const modal = page.getByRole('dialog', { name: "Alex's rewards" });
    await modal.waitFor({ state: 'visible' }); await modal.getByText('24', { exact: true }).waitFor();
    const geometry = await modal.evaluate(el => {
      const r = el.getBoundingClientRect(), close = el.querySelector('.school-rewards-modal__close').getBoundingClientRect(), body = el.querySelector('.school-rewards-modal__body');
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, closeTop: close.top, closeBottom: close.bottom, bodyOverflow: body.scrollWidth > body.clientWidth, documentOverflow: document.documentElement.scrollWidth > innerWidth, scrolls: body.scrollHeight > body.clientHeight };
    });
    assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= width + .5 && geometry.bottom <= height + .5, JSON.stringify(geometry));
    assert.ok(geometry.closeTop >= 0 && geometry.closeBottom <= height, 'close visible');
    assert.ok(!geometry.bodyOverflow && !geometry.documentOverflow, 'no horizontal overflow');
    assert.ok(geometry.scrolls, 'long rewards scroll inside modal');
    assert.ok(!(await modal.textContent()).includes('Jamie'), 'only own data');
    await page.screenshot({ path: join(outDir, `${width}x${height}.png`) });
    await modal.getByRole('button', { name: 'Back to today' }).scrollIntoViewIfNeeded();
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
  await page.getByRole('button', { name: 'Back to today' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Back to today' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  writeFileSync(join(outDir, 'geometry.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.length, reducedMotion: true, keyboard: true, focusRestoration: true, outDir }));
} finally {
  await browser.close(); await new Promise(r => server.close(r));
}
