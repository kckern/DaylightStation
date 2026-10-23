#!/usr/bin/env node
/**
 * Isolated real-component/styles sidebar, menu, and ceremony geometry checks.
 * No backend or hardware connection: all context data is synthetic and every
 * network request is confined to this ephemeral loopback fixture server.
 * Run: node tests/_infrastructure/harnesses/fitness-sidebar-layout.mjs [chromium|firefox]
 * Requires the selected Playwright browser to be installed.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontendRequire = createRequire(join(repo, 'frontend/package.json'));
const sass = frontendRequire('sass-embedded');
const engine = process.argv[2] || 'chromium';
assert.ok(['chromium', 'firefox'].includes(engine), 'Select chromium or firefox');

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
window.renderFixture = ({ count = 5, width = 300, height = 650, rpm = 0, zones = 1, inactive = false, menu = null, people = 0, achievement = false, home = false }) => {
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
  };
  const contributors = Array.from({length: people}, (_,i) => ({id: 'contributor-' + i, name: 'Long Participant Name ' + i }));
  flushSync(() => root.render(<React.Profiler id="fixture" onRender={() => {window.fixtureRenderCount++;}}><MantineProvider><FixtureContext.Provider value={context}>
    {home ? <div style={{position:'relative',width:'100vw',height:'100vh'}}>
      <FitnessNavbar navItems={Array.from({length:8},(_,i)=>({name:'Collection '+i,type:'collection',target:{collection_id:i}}))} onNavigate={()=>{}} />
      <div id="home-scroll" style={{position:'absolute',left:80,right:0,top:0,bottom:0,overflowY:'auto'}}><FitnessMenu activeCollection="fixture" onContentSelect={()=>{}} /></div>
      <FeedbackCornerButton onOpen={()=>{}} />
    </div> : <div style={{ position:'relative', width, height, background:'#080808' }}>
      <div className="fitness-sidebar-container"><div className="fitness-sidebar-devices"><FitnessUsersList /></div>
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
    builder.onResolve({ filter: /FeedbackOverlay\.jsx$/ }, () => ({ path: 'fixture-feedback', namespace: 'feedback' }));
    builder.onLoad({ filter: /.*/, namespace: 'feedback' }, () => ({contents:'export default () => null;'}));
    builder.onResolve({ filter: /FitnessContext\.jsx$/ }, () => ({ path: 'fixture-context', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: "import React from 'react'; export const FixtureContext = React.createContext({}); export const useFitnessContext = () => React.useContext(FixtureContext);",
      resolveDir: join(repo, 'frontend'),
    }));
    builder.onResolve({ filter: /logging\/singleton\.js$/ }, () => ({path:'fixture-singleton',namespace:'singleton'}));
    builder.onLoad({filter:/.*/,namespace:'singleton'},()=>({contents:'export const getChildLogger = () => ({info:()=>{},debug:()=>{},warn:()=>{},error:()=>{},sampled:()=>{}});'}));
    builder.onResolve({ filter: /logging\/Logger\.js$/ }, () => ({ path: 'fixture-logger', namespace: 'logger' }));
    builder.onLoad({ filter: /.*/, namespace: 'logger' }, () => ({ contents:
      'const noop = () => {}; const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop }; export default () => logger; export const getLogger = () => logger;' }));
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
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.renderFixture === 'function');
  const evidence = [];
  for (const viewport of [{width:1920,height:1080},{width:1381,height:777},{width:1024,height:640}]) {
    await page.setViewportSize(viewport);
    for (const count of [1,3,4,5,8]) {
      for (const rpm of [0,1,2,3,4,5]) {
        const options = { count, rpm, width: viewport.width === 1024 ? 250 : 300, height: viewport.height - 180, zones: Math.min(3,count), inactive: count===8 };
        await page.evaluate(options => window.renderFixture(options), options);
        await page.waitForFunction(count => document.querySelectorAll('.fitness-device.heart-rate').length === count &&
          [...document.querySelectorAll('.device-grid > *')].every(el => !el.style.transform && el.style.position !== 'absolute'), count);
        await page.waitForTimeout(60);
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
          return { grouping, room:list.clientHeight, scroll:list.scrollHeight,
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
        const overhead=geometry.bottom-geometry.cardHeights.reduce((sum,height)=>sum+height,0);
        if(count>1 && count*64+overhead<=geometry.room+1) {
          assert.ok(geometry.bottom<=geometry.room+1,'no needless overflow: '+JSON.stringify({options,geometry}));
          assert.ok(geometry.room-geometry.bottom<=count+2,'fill fitting multi-rider room: '+JSON.stringify({options,geometry}));
        }
        for (const row of geometry.rpmRows) {
          assert.ok(Math.abs(row.center-row.expected)<1, JSON.stringify({options,row}));
          assert.ok(Math.abs(row.width-46)<1, 'RPM diameter');
        }
        evidence.push({viewport,...options,...geometry});
      }
    }
    for (const menu of ['settings','guest']) {
      await page.evaluate(options=>window.renderFixture(options), {menu,width:viewport.width===1024?250:300,height:viewport.height-100,count:3});
      await page.waitForTimeout(120);
      if(menu==='settings') await page.locator('.menu-more summary').click();
      const geometry = await page.evaluate(() => {
        const root=document.querySelector('.fitness-sidebar-menu');
        const body=root.querySelector('.sidebar-menu-content');
        const header=root.querySelector('.sidebar-menu-header');
        body.scrollTop=body.scrollHeight;
        return { root:root.getBoundingClientRect().toJSON(), body:body.getBoundingClientRect().toJSON(),header:header.getBoundingClientRect().toJSON(),
          labels:[...root.querySelectorAll('.visibility-controls label > span:first-child')].map(el=>({text:el.textContent,width:el.clientWidth,scrollWidth:el.scrollWidth})),
          foreground:getComputedStyle(root.querySelector('summary')||root).color,
          fonts:[...root.querySelectorAll('.guest-menu-hint,.guest-menu-note,.guest-tab,.guest-option-name,.guest-option-source')].map(el=>({selector:el.className,size:parseFloat(getComputedStyle(el).fontSize)})),
          last:root.querySelector('.menu-more button:last-child')?.getBoundingClientRect().toJSON(),
          close:root.querySelector('.close-btn').getBoundingClientRect().toJSON() };
      });
      assert.ok(geometry.body.bottom<=geometry.root.bottom+1 && geometry.header.top>=geometry.root.top-1, JSON.stringify(geometry));
      assert.ok(geometry.close.width>=40 && geometry.close.height>=40,'close target');
      if(menu==='settings') {
        assert.ok(geometry.last.bottom<=geometry.body.bottom+1,'More tools reachable');
        assert.ok(geometry.labels.every(label=>label.width>=label.scrollWidth),'normal controls untruncated: '+JSON.stringify(geometry));
        assert.notEqual(geometry.foreground,'rgb(0, 0, 0)','visible More foreground');
      }
      assert.ok(geometry.fonts.every(f=>f.size>=14),JSON.stringify(geometry));
      if(menu==='guest') assert.ok(geometry.fonts.length>=5,'guest selectors rendered');
      evidence.push({viewport,menu,...geometry});
      await page.screenshot({path:'/tmp/task3-'+engine+'-'+viewport.width+'-'+menu+'.png'});
    }
    for(const achievement of [false,true]) for(const people of [1,2,5]) {
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
      if(people===5) await page.screenshot({path:'/tmp/task3-'+engine+'-'+viewport.width+'-ceremony-'+achievement+'.png'});
    }
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
    await page.screenshot({path:'/tmp/task3-'+engine+'-'+viewport.width+'-home.png'});
    await page.evaluate(()=>window.renderFixture({count:5,rpm:5,zones:3,width:300,height:597}));
    await page.waitForTimeout(420);
    await page.screenshot({path:'/tmp/task3-'+engine+'-'+viewport.width+'-roster.png'});
  }
  for(const options of [{count:8,rpm:5,zones:3},{count:3,rpm:1,zones:1},{count:5,rpm:5,zones:3,width:250},{count:5,rpm:2,zones:2,width:345}]) {
    await page.evaluate(options=>window.renderFixture({...options,height:597}),options);
    await page.waitForTimeout(650);
    const before=await page.evaluate(()=>({commits:window.fixtureRenderCount,height:document.querySelector('.device-grid').style.getPropertyValue('--rider-card-height')}));
    await page.waitForTimeout(650);
    const after=await page.evaluate(()=>({commits:window.fixtureRenderCount,height:document.querySelector('.device-grid').style.getPropertyValue('--rider-card-height')}));
    assert.deepEqual(after,before,'roster transition must settle: '+JSON.stringify(options));
    evidence.push({transition:options,settled:after});
  }
  assert.deepEqual(errors,[]);
  const {writeFile}=await import('node:fs/promises');
  await writeFile('/tmp/task3-'+engine+'-geometry.json',JSON.stringify(evidence,null,2));
  process.stdout.write(JSON.stringify({engine,checks:evidence.length,errors})+'\n');

} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
