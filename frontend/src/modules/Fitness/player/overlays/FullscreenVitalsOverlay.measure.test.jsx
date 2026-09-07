import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '../../../../..');
let browser, script, css;

beforeAll(async () => {
  const { build } = await import('esbuild');
  const sass = await import('sass-embedded');
  const sheets = new Set();
  const built = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import Overlay from ${JSON.stringify(path.join(here, 'FullscreenVitalsOverlay.jsx'))};
      import Fab from ${JSON.stringify(path.join(here, '../FitnessChartVoiceMemoFab.jsx'))};
      let root;window.renderOverlay=()=>{root=createRoot(document.getElementById('content'));root.render(React.createElement(React.Fragment,null,React.createElement('div',{className:'fitness-video-shell',style:{position:'relative',width:'100%',height:'100%'}},React.createElement(Overlay,{visible:true})),React.createElement(Fab,{sessionActive:true,onRecord:()=>{}}))); };window.unmountOverlay=()=>root.unmount();`, resolveDir: frontend, loader: 'jsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { '@': path.join(frontend, 'src') },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"test"}' },
    plugins: [{ name: 'vitals-test-boundaries', setup(b) {
      b.onResolve({ filter: /FitnessContext\.jsx$/ }, () => ({ path: 'context', namespace: 'mock' }));
      b.onResolve({ filter: /lib\/api\.mjs$/ }, () => ({ path: 'api', namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: name === 'context'
        ? 'export const useFitnessContext=()=>window.fixture;'
        : 'export const DaylightMediaPath=()=>"data:image/svg+xml,<svg xmlns=\\"http://www.w3.org/2000/svg\\"/>";' }));
      b.onLoad({ filter: /\.(scss|css)$/ }, ({ path: file }) => { sheets.add(file); return { contents: '' }; });
    } }],
  });
  script = built.outputFiles[0].text;
  const ordered = [...sheets].filter(p => !p.endsWith('FullscreenVitalsOverlay.scss'));
  ordered.push(path.join(here, 'FullscreenVitalsOverlay.scss'),path.join(here,'../FitnessPlayer.scss'));
  css = (await Promise.all(ordered.map(file => sass.compileAsync(file)))).map(r => r.css).join('\n');
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
}, 60000);
afterAll(async () => { await browser?.close(); });

async function mount(width, height, people = 6, equipment = 2) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${css}</style><div id="player" class="fitness-player mode-fullscreen" style="position:relative;background:linear-gradient(135deg,#243746,#14242c);width:${width}px;height:${height}px"><div id="content" class="fitness-player-content" style="position:relative;width:100%;height:100%"></div></div>`);
  await page.evaluate(({ people, equipment }) => {
    window.observerDisconnects=0;const NativeObserver=window.ResizeObserver;window.ResizeObserver=class extends NativeObserver {disconnect(){window.observerDisconnects++;super.disconnect();}};
    window.fixture = {
      heartRateDevices: Array.from({ length: people }, (_, i) => ({ deviceId: `sensor-${i}`, heartRate: 130, connectionState: 'connected' })),
      getUserByDevice: id => ({ id, name: id }),
      rpmDevices: Array.from({ length: Math.max(0, equipment - 1) }, (_, i) => ({ deviceId: `bike-${i}`, cadence: 80 })),
      pressureMatActivities: equipment ? { mat: { equipmentId: 'mat', seenThisSession: true, active: true, online: true, stepsPerMinute: 50, sessionSteps: 125, sessionStomps: 10 } } : {},
    };
  }, { people, equipment });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => window.renderOverlay());
  await page.waitForFunction(() => document.querySelector('.fullscreen-vitals-overlay')?.getBoundingClientRect().width > 0);
  return page;
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
    const overlay = document.querySelector('.fullscreen-vitals-overlay');
    return { parent:box(document.getElementById('player')), overlay:box(overlay), fab:box(document.querySelector('.fitness-player__voice-memo-fab')),
      tiles:[...overlay.querySelectorAll('.circular-user-avatar,.vital-rpm,.step-mat-tile')].map(box),
      hr:[...overlay.querySelectorAll('.circular-user-avatar')].map(box),
      equipment:[...overlay.querySelectorAll('.vital-rpm,.step-mat-tile')].map(box) };
  });
}
function expectFits(g) {
  const overlaps=g.fab.x < g.overlay.right && g.fab.right > g.overlay.x && g.fab.y < g.overlay.bottom && g.fab.bottom > g.overlay.y;
  expect(overlaps, JSON.stringify({overlay:g.overlay,fab:g.fab,parent:g.parent})).toBe(false);
  expect(g.overlay.width).toBeLessThanOrEqual(Math.min(320,g.parent.width*0.3)+0.1);
  expect(g.overlay.height).toBeLessThanOrEqual(g.parent.height*0.55+0.1);
  for(const tile of g.tiles) {
    expect(tile.x).toBeGreaterThanOrEqual(g.overlay.x-0.1);
    expect(tile.right).toBeLessThanOrEqual(g.overlay.right+0.1);
    expect(tile.y).toBeGreaterThanOrEqual(g.overlay.y-0.1);
    expect(tile.bottom).toBeLessThanOrEqual(g.overlay.bottom+0.1);
  }
  for(const tile of g.hr) expect(Math.abs(tile.width-tile.height)).toBeLessThan(0.1);
}

describe('FullscreenVitalsOverlay browser geometry', () => {
  it('fits six round avatars and a shared bike/mat row and toggles its anchor', async () => {
    const page = await mount(1280,720);
    try {
      const g = await geometry(page); expectFits(g);
      await page.locator('#player').screenshot({path:'/tmp/fullscreen-vitals-six-user.png'});
      expect(g.hr).toHaveLength(6); expect(g.equipment).toHaveLength(2);
      expect(Math.abs((g.equipment[0].y+g.equipment[0].height/2)-(g.equipment[1].y+g.equipment[1].height/2))).toBeLessThan(0.1);
      await page.locator('.fullscreen-vitals-overlay').click();
      await page.waitForFunction(() => document.querySelector('.fullscreen-vitals-overlay').classList.contains('anchor-left'));
      const left = await geometry(page); expectFits(left); expect(left.overlay.x).toBeLessThan(g.overlay.x);
      await page.evaluate(()=>document.getElementById('player').classList.remove('mode-fullscreen'));
      const chart=await geometry(page);
      expect(chart.fab.bottom).toBeCloseTo(chart.parent.bottom-96,1);
      await page.evaluate(()=>window.unmountOverlay());
      expect(await page.evaluate(()=>window.observerDisconnects)).toBe(1);
    } finally { await page.close(); }
  });
  it('reflows when only the parent shrinks and scales a crowded roster within its budget', async () => {
    const page = await mount(1280,720,12,4);
    try {
      expectFits(await geometry(page));
      await page.evaluate(() => {const p=document.getElementById('player');p.style.width='480px';p.style.height='270px';});
      await page.waitForFunction(() => document.querySelector('.fullscreen-vitals-overlay').getBoundingClientRect().width <=144.1);
      expectFits(await geometry(page));
    } finally { await page.close(); }
  });
});
