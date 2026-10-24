#!/usr/bin/env node
/**
 * Isolated real-component/styles sidebar, menu, and ceremony geometry checks.
 * No backend or hardware connection: all context data is synthetic and every
 * network request is confined to this ephemeral loopback fixture server.
 * Run: node tests/_infrastructure/harnesses/fitness-sidebar-layout.mjs [chromium|firefox] [--integration-only] [--only=roster,trend,menu,toast,home,transition,integration] [--out-dir <dir>]
 * --only runs just the named sections (cheap targeted checks); the default runs all of them.
 * Screenshots and geometry.json go to a fresh per-run directory under the OS temp dir
 * (fitness-harness-XXXXXX) unless --out-dir or FITNESS_HARNESS_OUT_DIR names one.
 * The directory is printed to stderr at start and reported as `outDir` in the result line.
 * Requires the selected Playwright browser to be installed.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { verifyIntegration } from './fitness-integration-checks.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendRequire = createRequire(join(repo, 'frontend/package.json'));
const sass = frontendRequire('sass-embedded');
const args = process.argv.slice(2);
let requestedOutDir = process.env.FITNESS_HARNESS_OUT_DIR || null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out-dir') requestedOutDir = args[++i];
  else if (args[i].startsWith('--out-dir=')) requestedOutDir = args[i].slice('--out-dir='.length);
  else if (!args[i].startsWith('--')) positional.push(args[i]);
}
assert.ok(requestedOutDir !== undefined && requestedOutDir !== '', '--out-dir needs a directory');
const engine = positional[0] || 'chromium';
const onlyArg = args.find(a => a.startsWith('--only='));
const onlySections = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const has = section => !onlySections || onlySections.has(section);
assert.ok(['chromium', 'firefox'].includes(engine), 'Select chromium or firefox');
const outDir = requestedOutDir
  ? (mkdirSync(resolve(requestedOutDir), { recursive: true }), resolve(requestedOutDir))
  : mkdtempSync(join(tmpdir(), 'fitness-harness-'));
const artifact = name => join(outDir, `${engine}-${name}`);
process.stderr.write(`fitness-harness: writing screenshots and geometry to ${outDir}\n`);

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './__app_modules/wellness/fitness/browser/FitnessApp.scss';
import { sortByZoneRank } from './__app_modules/wellness/fitness/browser/domain/ParticipantFactory.js';
import FitnessUsersList from './__app_modules/wellness/fitness/browser/player/panels/FitnessUsers.jsx';
import FitnessSidebarMenu from './__app_modules/wellness/fitness/browser/player/panels/FitnessSidebarMenu.jsx';
import FitnessNavbar from './__app_modules/wellness/fitness/browser/nav/FitnessNavbar.jsx';
import FitnessMenu from './__app_modules/wellness/fitness/browser/nav/FitnessMenu.jsx';
import FeedbackCornerButton from './__app_modules/wellness/fitness/browser/feedback/FeedbackCornerButton.jsx';
import FitnessToast from './__app_modules/wellness/fitness/browser/player/overlays/FitnessToast.jsx';
import { FixtureContext } from './__app_modules/wellness/fitness/browser/context/FitnessContext.jsx';
window.fixtureRenderCount = 0;
const fixtureMedia = document.createElement('video');
const root = createRoot(document.getElementById('root'));
import { installIntegration } from './tests/_infrastructure/harnesses/fitness-integration-fixture.jsx';
installIntegration(root, FixtureContext);
window.renderFixture = ({ count = 5, width = 300, height = 650, rpm = 0, zones = 1, inactive = false, menu = null, people = 0, achievement = false, home = false, gov = false, media = false, ticks = 0 }) => {
  const zoneIds = ['cool', 'active', 'warm', 'hot', 'fire'];
  const devices = Array.from({ length: count }, (_, i) => ({
    id: 'rider-' + i, profileId: 'rider-' + i, deviceId: String(101 + i), type: 'heart_rate', heartRate: 123 + i,
    name: 'Long Participant Name ' + i, zoneId: zoneIds[i % zones], rawZoneId: 'fire', isActive: !inactive, lastSeen: Date.now()
  }));
  const context = {
    connected: true, fitnessDevices: new Map(devices.map(d => [d.deviceId, d])), allDevices: devices,
    participantRoster: devices, participantsByDevice: Object.fromEntries(devices.map(d => [d.deviceId,d])),
    activeHeartRateParticipants: sortByZoneRank(devices), rpmDevices: Array.from({length:rpm}, (_, i) => ({ deviceId: String(200 + i), type: 'cadence', cadence: 45, isActive: true })), equipmentDevices: [],
    deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
    hrColorMap: Object.fromEntries(devices.map(d => [d.deviceId, 'purple'])), zones: [], zoneProfiles: [],
    deviceAssignments: [], zoneProgressIndex: new Map(), userCollections: { all: [] }, deviceOwnership: {}, pressureMatActivities: {},
    getDisplayName: id => ({ displayName: 'Long Participant Name ' + id, source: 'fixture' }),
    fitnessSessionInstance: { getEquipmentUser: () => null },
    ...(ticks ? {
      timelineTimebase: { tickCount: ticks, intervalMs: 5000 },
      getParticipantTimelineSeries: (id, metric) => Array.from({ length: ticks }, (_, t) => {
        const hr = Math.round(110 + 40 * Math.sin(t / 15 + id.length));
        return metric === 'heart_rate' ? hr : (hr >= 140 ? 'hot' : hr >= 120 ? 'warm' : 'active');
      }),
    } : {}),
  };
  const contributors = Array.from({length: people}, (_,i) => ({id: 'contributor-' + i, name: 'Long Participant Name ' + i }));
  flushSync(() => root.render(<React.Profiler id="fixture" onRender={() => {window.fixtureRenderCount++;}}><MantineProvider><FixtureContext.Provider value={context}>
    {home ? <div style={{position:'relative',width:'100vw',height:'100vh'}}>
      <FitnessNavbar navItems={Array.from({length:8},(_,i)=>({name:'Collection '+i,type:'collection',target:{collection_id:i}}))} onNavigate={()=>{}} />
      <div id="home-scroll" style={{position:'absolute',left:80,right:0,top:0,bottom:0,overflowY:'auto'}}><FitnessMenu activeCollection="fixture" onContentSelect={()=>{}} /></div>
      <FeedbackCornerButton onOpen={()=>{}} />
    </div> : <div style={{ position:'relative', width, height, background:'#080808' }}>
      <div className="fitness-sidebar-container">
      {gov && <div className="fitness-sidebar-governance" style={{height:59,flexShrink:0}} />}
      <div className="fitness-sidebar-devices"><FitnessUsersList /></div>
      {media && <div className="fitness-sidebar-media" style={{background:'#222'}} />}
      {menu && <FitnessSidebarMenu mode={menu} targetDeviceId="unknown" guestCandidates={Array.from({length:15},(_,i) => ({ id:'guest-'+i, name:'Guest Person '+i, source:'friend' }))}
        onClose={() => {window.closedCount = (window.closedCount || 0)+1;}} visibility={{}} onToggleVisibility={() => {}}
        playerRef={{current:{getMediaElement:()=>fixtureMedia}}} boostLevel={1} setBoost={()=>{}} videoVolume={{volume:.5}}
        activeSessionId="fixture" onEndSession={()=>{}} />}
      </div>
    </div>}
    {people > 0 && <FitnessToast key={people+'-'+achievement} toast={{id: people*2+Number(achievement), title:'Challenge complete', variant:'success', durationMs:60000, achievement, contributors}} />}
  </FixtureContext.Provider></MantineProvider></React.Profiler>));
};
window.renderFixture({});
`;

const bundle = await build({
  stdin: { contents: entry, loader: 'jsx', resolveDir: repo, sourcefile: 'fitness-fixture.jsx' },
  jsx: 'automatic', bundle: true, write: false, outdir: '/fixture', format: 'iife',
  nodePaths: [join(repo, 'frontend/node_modules')],
  alias: { '@': join(repo, 'frontend/src'), react: join(repo, 'frontend/node_modules/react'), 'react-dom': join(repo, 'frontend/node_modules/react-dom') },
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.MODE': '"test"' },
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
  logLevel: 'silent',
  plugins: [{ name: 'isolated-fitness', setup(builder) {
    builder.onResolve({ filter: /FitnessModuleMenu\.jsx$/ }, () => ({path:'unused-module-menu',namespace:'module-menu'}));
    builder.onLoad({filter:/.*/,namespace:'module-menu'},()=>({contents:'export default () => null;'}));
    builder.onResolve({ filter: /FitnessContext\.jsx$/ }, () => ({ path: 'fixture-context', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: "import React from 'react'; export const FixtureContext = React.createContext({}); export const useFitnessContext = () => React.useContext(FixtureContext);",
      resolveDir: join(repo, 'frontend'),
    }));
    builder.onResolve({ filter: /logging\/singleton\.js$/ }, () => ({path:'fixture-singleton',namespace:'singleton'}));
    builder.onLoad({filter:/.*/,namespace:'singleton'},()=>({contents:'export const getChildLogger = () => ({info:()=>{},debug:()=>{},warn:()=>{},error:()=>{},sampled:()=>{}});'}));
    builder.onResolve({ filter: /logging\/Logger\.js$/ }, () => ({ path: 'fixture-logger', namespace: 'logger' }));
    builder.onLoad({ filter: /.*/, namespace: 'logger' }, () => ({ contents:
      'const noop = () => {}; const capture = (event, data) => { (window.fixtureEvents ||= []).push({event,data}); }; const logger = { child: () => logger, debug: noop, info: capture, warn: capture, error: capture, sampled: noop }; export default () => logger; export const getLogger = () => logger; export const getRecentEvents = () => [];' }));
    builder.onLoad({ filter: /\.scss$/ }, async ({ path }) => ({
      contents: (await sass.compileAsync(path, { logger: sass.Logger.silent, loadPaths: [join(repo, 'frontend/node_modules')] })).css,
      loader: 'css', resolveDir: dirname(path),
    }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const server = createServer((req, res) => {
  if (req.url === '/api/v1/fitness') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({fitness:{content:{nav_items:[{name:'Fixture',type:'collection',target:{collection_id:'fixture'}}]}}})); }
  else if (req.url === '/api/v1/list/plex/fixture') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({items:Array.from({length:35},(_,i)=>({id:'show-'+i,label:'Workout '+i,image:'/fixture.svg',play:{plex:'show-'+i}}))})); }
  else if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(js); }
  else if (req.url === '/bundle.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/bundle.css"></head><body style="margin:0;background:#111"><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  else { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#444"/></svg>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await ({ chromium, firefox })[engine].launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1.39, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
    Object.defineProperty(navigator, 'mediaDevices', {value: {getUserMedia: () => Promise.reject(new Error('Acceptance fixture never opens microphones')), enumerateDevices: async () => []}, configurable: true});
  });
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.renderFixture === 'function');
  const evidence = [];
  if (!process.argv.includes('--integration-only')) {
  for (const viewport of [{width:1920,height:1080},{width:1381,height:777},{width:1024,height:640}]) {
    await page.setViewportSize(viewport);
    for (const count of (has('roster') ? [1,3,4,5,8] : [])) {
      for (const rpm of [0,1,2,3,4,5]) for (const gov of [false,true]) {
        // media: the real 16:9 camera/controls panel below the roster; gov: the
        // ~59px governance lock panel that took the 2026-10-23 roster under.
        const options = { count, rpm, gov, media: true, width: viewport.width === 1024 ? 250 : 300, height: viewport.height - 40, zones: Math.min(3,count), inactive: count===8 };
        await page.evaluate(options => window.renderFixture(options), options);
        await page.waitForFunction(count => document.querySelectorAll('.fitness-device.heart-rate').length === count &&
          [...document.querySelectorAll('.device-grid > *')].every(el => !el.style.transform && el.style.position !== 'absolute'), count);
        // A pinned RPM block appearing or leaving resizes the list after the
        // roster settles, which re-sizes cards and starts a second FLIP pass.
        // Wait until two reads 150ms apart agree and nothing is mid-animation.
        let previous = null;
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(150);
          const snapshot = await page.evaluate(() => {
            const grid = document.querySelector('.device-grid');
            const moving = [...grid.children].some(el => el.style.transform || el.style.transition || el.style.position === 'absolute' || (el.style.opacity && el.style.opacity !== '1'));
            return moving ? null : grid.style.getPropertyValue('--rider-card-height') + '|' + document.querySelector('.fitness-devices').clientHeight;
          });
          if (snapshot && snapshot === previous) break;
          previous = snapshot;
        }
        const geometry = await page.evaluate(() => {
          const list = document.querySelector('.fitness-devices');
          const cards = [...document.querySelectorAll('.fitness-device.heart-rate')];
          const grid = document.querySelector('.device-grid');
          const rect = el => el.getBoundingClientRect();
          const rows = new Map();
          let currentZone = null;
          const grouping = [];
          for(const wrapper of grid.querySelectorAll('.device-wrapper')) {
            const header=wrapper.querySelector('.device-zone-info');
            if(header?.textContent) currentZone = header.textContent.toLowerCase();
            const card=wrapper.querySelector('.fitness-device.heart-rate');
            if(card) grouping.push(card.classList.contains('zone-'+currentZone));
          }
          for (const el of document.querySelectorAll('.rpm-device-avatar')) {
            const r = rect(el); const key = Math.round(r.top);
            rows.set(key, [...(rows.get(key)||[]), r]);
          }
          const rpmGroup = document.querySelector('.rpm-devices');
          const pinned = document.querySelector('.fitness-devices-pinned');
          const mediaPanel = document.querySelector('.fitness-sidebar-media');
          const visibleBottom = Math.max(Math.min(rect(list).bottom, Math.max(...cards.map(el=>rect(el).bottom))), pinned ? rect(pinned).bottom : 0);
          return { grouping, room:list.clientHeight, scroll:list.scrollHeight,
            rpmInList: !!list.querySelector('.rpm-group-container'),
            pinned: pinned ? rect(pinned).toJSON() : null, listRect: rect(list).toJSON(),
            mediaGap: rect(mediaPanel).top - visibleBottom,
            height: parseFloat(grid.style.getPropertyValue('--rider-card-height')),
            cardHeights: cards.map(el=>rect(el).height),
            bottom:Math.max(...[...grid.children].map(el=>rect(el).bottom)) - rect(list).top,
            rpmRows:[...rows.values()].map(row=>({count:row.length, width:row[0].width, center:(row[0].left+row.at(-1).right)/2, expected:(rect(rpmGroup).left+rect(rpmGroup).right)/2})),
            clipped:cards.some(el=> { const r=rect(el); return [...el.querySelectorAll('.device-stats,.card-avatar')].some(child=>rect(child).right>r.right+1 || rect(child).bottom>r.bottom+1); }),
            units:[...document.querySelectorAll('.device-unit,.device-name')].map(el=>parseFloat(getComputedStyle(el).fontSize)) };
        });
        assert.ok(geometry.grouping.every(Boolean),'coherent zone headings: '+JSON.stringify(geometry));
        assert.ok(!geometry.clipped, JSON.stringify({options,geometry}));
        assert.ok(geometry.units.every(size=>size>=14), '14px floor');
        assert.ok(geometry.cardHeights.every(h=>h>=63.5 && Math.abs(h-geometry.height)<0.5), JSON.stringify({options,geometry}));
        if(count===1) assert.ok(geometry.height<=132,'single rider height cap');
        assert.ok(geometry.mediaGap>=7.5,'gap above the camera panel: '+JSON.stringify({options,mediaGap:geometry.mediaGap}));
        assert.ok(!geometry.rpmInList,'RPM never inside the scrolling list');
        if(rpm>0) {
          assert.ok(geometry.pinned && geometry.pinned.top>=geometry.listRect.bottom-0.5,'RPM pinned below the list: '+JSON.stringify({options,geometry}));
          assert.ok(geometry.pinned.bottom<=viewport.height && geometry.pinned.bottom<=geometry.listRect.bottom+geometry.pinned.height+0.5,'RPM fully visible: '+JSON.stringify({options,geometry}));
        }
        const overhead=geometry.bottom-geometry.cardHeights.reduce((sum,height)=>sum+height,0);
        if(count>1 && count*64+overhead<=geometry.room+1) {
          assert.ok(geometry.bottom<=geometry.room+1,'no needless overflow: '+JSON.stringify({options,geometry}));
          // floor() loses <1px per card; fractional header heights add up to ~1px more.
          assert.ok(geometry.room-geometry.bottom<=count+3,'fill fitting multi-rider room: '+JSON.stringify({options,geometry}));
        }
        for (const row of geometry.rpmRows) {
          assert.ok(Math.abs(row.center-row.expected)<1, JSON.stringify({options,row}));
          assert.ok(Math.abs(row.width-46)<1, 'RPM diameter');
        }
        evidence.push({viewport,...options,...geometry});
      }
    }
    for (const menu of (has('menu') ? ['settings','guest'] : [])) {
      await page.evaluate(options=>window.renderFixture(options), {menu,width:viewport.width===1024?250:300,height:viewport.height,count:3});
      await page.waitForTimeout(120);
      const geometry = await page.evaluate(() => {
        const root=document.querySelector('.fitness-sidebar-menu');
        const body=root.querySelector('.sidebar-menu-content');
        const rect=el=>el.getBoundingClientRect().toJSON();
        const controls=[...root.querySelectorAll('.settings-stack button, .settings-stack input')].map(el=>{const t=el.closest('label')||el;return {name:el.getAttribute('aria-label')||el.textContent.trim(),top:rect(t).top,bottom:rect(t).bottom,height:rect(t).height};});
        const overflow=body.scrollHeight-body.clientHeight;
        body.scrollTop=0;
        const firstTop=controls.length?rect(root.querySelector('.settings-stack button, .settings-stack input')).top:null;
        return { root:rect(root), body:rect(body), overflow, firstTopAtScrollTop0:firstTop, controls,
          details:root.querySelectorAll('details').length,
          focused:document.activeElement?.getAttribute('aria-label')||null,
          labels:[...root.querySelectorAll('.visibility-controls label > span:first-child')].map(el=>({text:el.textContent,width:el.clientWidth,scrollWidth:el.scrollWidth})),
          fonts:[...root.querySelectorAll('.guest-menu-hint,.guest-menu-note,.guest-tab,.guest-option-name,.guest-option-source')].map(el=>({selector:el.className,size:parseFloat(getComputedStyle(el).fontSize)})),
          close:rect(root.querySelector('.sidebar-menu-footer .close-btn')) };
      });
      assert.ok(geometry.body.bottom<=geometry.close.top+1 && geometry.body.top>=geometry.root.top-1, JSON.stringify(geometry));
      // Close is a bottom footer in both modes, in reach of a short rider.
      assert.ok(geometry.close.bottom>=geometry.root.bottom-80 && geometry.close.height>=56 && geometry.close.width>=geometry.root.width-30,'bottom close target: '+JSON.stringify(geometry.close));
      assert.ok(/^Close /.test(geometry.focused||''),'Close focused on open');
      if(menu==='settings') {
        assert.equal(geometry.details,0,'no More overflow');
        assert.ok(geometry.labels.every(label=>label.width>=label.scrollWidth),'normal controls untruncated: '+JSON.stringify(geometry));
        assert.ok(geometry.controls.every(c=>c.height>=40),'touch targets: '+JSON.stringify(geometry.controls));
        if(viewport.height>=777) {
          // Kiosk height and up: everything fits without scrolling, in the lower 60%.
          assert.ok(geometry.overflow<=0,'settings fit unscrolled: '+geometry.overflow);
          assert.ok(geometry.controls.every(c=>c.top>=geometry.root.top+geometry.root.height*0.35),'controls in the lower band: '+JSON.stringify(geometry.controls));
        } else {
          assert.ok(geometry.firstTopAtScrollTop0>=geometry.body.top-1,'top of a short stack stays reachable by scroll');
        }
      }
      assert.ok(geometry.fonts.every(f=>f.size>=14),JSON.stringify(geometry));
      if(menu==='guest') assert.ok(geometry.fonts.length>=5,'guest selectors rendered');
      evidence.push({viewport,menu,...geometry});
      await page.screenshot({path:artifact(viewport.width+'-'+menu+'.png')});
    }
    for(const achievement of (has('toast') ? [false,true] : [])) for(const people of [1,2,5]) {
      await page.evaluate(options=>window.renderFixture(options),{people,achievement,width:300,height:500});
      await page.waitForTimeout(60);
      const geometry=await page.evaluate(()=>{
        const toast=document.querySelector('.fitness-toast');const rect=toast.getBoundingClientRect();
        const group=toast.querySelector('.fitness-toast__faces,.fitness-toast__contributors');const rows=new Map();
        for(const el of group.children){const r=el.getBoundingClientRect();const key=Math.round(r.top);rows.set(key,[...(rows.get(key)||[]),r]);}
        const headline=toast.querySelector('.fitness-toast__headline,.fitness-toast__title').getBoundingClientRect();
        return { headline:headline.toJSON(), toast:rect.toJSON(), rows:[...rows.values()].map(row=>({center:(row[0].left+row.at(-1).right)/2,expected:(rect.left+rect.right)/2,bottom:Math.max(...row.map(r=>r.bottom))}))};
      });
      assert.ok(Math.abs((geometry.headline.left+geometry.headline.right)/2-(geometry.toast.left+geometry.toast.right)/2)<3,'centered challenge headline: '+JSON.stringify(geometry));
      for(const row of geometry.rows){assert.ok(Math.abs(row.center-row.expected)<3,JSON.stringify({people,achievement,geometry}));assert.ok(row.bottom<=geometry.toast.bottom,JSON.stringify(geometry));}
      evidence.push({viewport,people,achievement,...geometry});
      if(people===5) await page.screenshot({path:artifact(viewport.width+'-ceremony-'+achievement+'.png')});
    }
    if (has('home')) {
    await page.evaluate(()=>window.renderFixture({home:true,count:0}));
    await page.waitForSelector('.show-card');
    const homeGeometry = await page.evaluate(()=>{
      const scroll=document.querySelector('#home-scroll');scroll.scrollTop=scroll.scrollHeight;
      const last=document.querySelector('.show-card:last-child').getBoundingClientRect();
      const mic=document.querySelector('.fitness-feedback-trigger').getBoundingClientRect();
      return {last:last.toJSON(),mic:mic.toJSON(),nav:[...document.querySelectorAll('.navbar-nav .nav-item')].map(el=>el.getBoundingClientRect().height)};
    });
    assert.ok(homeGeometry.nav.length===8 && homeGeometry.nav.every(height=>height>=40),'nav targets');
    assert.ok(homeGeometry.last.bottom<homeGeometry.mic.top,JSON.stringify(homeGeometry));
    evidence.push({viewport,home:true,...homeGeometry});
    await page.screenshot({path:artifact(viewport.width+'-home.png')});
    await page.evaluate(()=>window.renderFixture({count:5,rpm:5,zones:3,width:300,height:597}));
    await page.waitForTimeout(420);
    await page.screenshot({path:artifact(viewport.width+'-roster.png')});
    }
  }
  // HR trend (hrTrend.js): cards >= 116px draw a whole-session sparkline; a
  // single rider grows past 132px to give it room; short cards never draw one.
  for (const options of (has('trend') ? [{count:1,ticks:600},{count:2,ticks:600},{count:5,ticks:600},{count:1,ticks:1}] : [])) {
    await page.setViewportSize({width:1381,height:777});
    await page.evaluate(o=>window.renderFixture({...o,media:true,width:250,height:737,zones:Math.min(3,o.count)}),options);
    await page.waitForTimeout(900);
    const trend = await page.evaluate(() => {
      const cards=[...document.querySelectorAll('.fitness-device.heart-rate')];
      return cards.map(card=>{const r=card.getBoundingClientRect();const svg=card.querySelector('.rider-hr-trend');const s=svg?.getBoundingClientRect();
        return {height:r.height,trend:!!svg,lines:card.querySelectorAll('polyline').length,inside:!s||(s.top>=r.top-0.5&&s.bottom<=r.bottom+0.5&&s.left>=r.left-0.5&&s.right<=r.right+0.5),chartHeight:s?.height||0};});
    });
    for (const card of trend) {
      assert.equal(card.trend, card.height>=116 && options.ticks>=2, 'trend iff tall card with a timeline: '+JSON.stringify({options,card}));
      assert.ok(card.inside,'trend inside its card: '+JSON.stringify(card));
      if (card.trend) assert.ok(card.lines>0 && card.chartHeight>=20,'chart has room and lines: '+JSON.stringify(card));
    }
    if (options.count===1) assert.ok(options.ticks>=2 ? trend[0].height>132 : trend[0].height<=132,'single-rider cap follows the trend: '+JSON.stringify(trend));
    evidence.push({trend:options,cards:trend});
    await page.screenshot({path:artifact('trend-'+options.count+'-'+options.ticks+'.png')});
  }
  for(const options of !has('transition') ? [] : [{count:8,rpm:5,zones:3},{count:3,rpm:1,zones:1},{count:5,rpm:5,zones:3,width:250},{count:5,rpm:2,zones:2,width:345}]) {
    await page.evaluate(options=>window.renderFixture({...options,height:597}),options);
    await page.waitForTimeout(650);
    const before=await page.evaluate(()=>({commits:window.fixtureRenderCount,height:document.querySelector('.device-grid').style.getPropertyValue('--rider-card-height')}));
    await page.waitForTimeout(650);
    const after=await page.evaluate(()=>({commits:window.fixtureRenderCount,height:document.querySelector('.device-grid').style.getPropertyValue('--rider-card-height')}));
    assert.deepEqual(after,before,'roster transition must settle: '+JSON.stringify(options));
    evidence.push({transition:options,settled:after});
  }
  }
  if (has('integration')) await verifyIntegration(page, evidence, engine, outDir);
  assert.deepEqual(errors,[]);
  const {writeFile}=await import('node:fs/promises');
  await writeFile(artifact('geometry.json'),JSON.stringify(evidence,null,2));
  process.stdout.write(JSON.stringify({engine,scope:process.argv.includes('--integration-only')?'integration-only':'full',checks:evidence.length,errors,outDir})+'\n');

} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
