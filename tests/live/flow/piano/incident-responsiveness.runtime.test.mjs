/** Self-contained fixture profile. No household frontend/backend is started.
 * BASE_URL must be set when using the shared config, to suppress its webServer.
 * PIANO_PROFILE_ONLY=1 records without the bounded-seek assertion.
 * PIANO_PROFILE_BASELINE_REF optionally profiles a committed player revision.
 */
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const player = '__app_modules/learning/piano/browser/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx';
const mocks = {
  '/ui/icons/Icon.jsx': `export default ()=>null;`,
  'LessonDrill.jsx': `export default ()=>null;`,
  'PianoMidiContext.jsx': `import {useSyncExternalStore} from 'react';
    const listeners=new Set(); let notes=new Map();
    const subscribe=(fn)=>{listeners.add(fn);return()=>listeners.delete(fn)};
    const state={subscribe,pressNote(){},releaseNote(){}};
    export const usePianoMidi=()=>state;
    export const usePianoMidiNotes=()=>({activeNotes:useSyncExternalStore(subscribe,()=>notes)});
    window.fixtureMidi=()=>{notes=new Map([[60,{velocity:80}]]);for(const fn of listeners)fn({type:'note_on',note:60,velocity:80,time:Date.now()})};
    window.fixtureSubscriptions=()=>listeners.size;`,
  'usePianoPlayback.js': `const noop=()=>{}; const state={setPlaying:noop,setVideoActive:noop};export const usePianoPlayback=()=>state;`,
  'usePianoMix.js': `export const usePianoMix=()=>({mediaLevel:0.5,setMediaLevel:()=>{}});`,
  'PianoBreadcrumbContext.jsx': `export const usePianoBreadcrumb=()=>{};`,
  'PianoUserContext.jsx': `export const usePianoUser=()=>({currentUser:'fixture-learner'});`,
  '/sessions.mjs': `export const usePlayerSessionBinding=()=>{};`,
  '/api.mjs': `export const DaylightAPI=async(url,body)=>{const r=await fetch('/'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('fixture rejected '+url);return r.json()};`,
  '/Logger.js': `export const getRecentEvents=()=>[];export const getConfig=()=>({});const sink=(event,data)=>window.fixtureMetrics.events.push({event,at:performance.now(),data}); const log={child:()=>log,info:sink,debug:sink,warn:sink,error:sink,sampled:sink};export default ()=>log;`,
  '/media/media/browser/playback.mjs': `import {forwardRef,useRef,useEffect,useImperativeHandle} from 'react';
    export default forwardRef(({play},ref)=>{const el=useRef();
      useEffect(()=>{window.fixtureMetrics.generations++;return()=>{window.fixtureMetrics.disposed++}},[]);
      useImperativeHandle(ref,()=>({getMediaElement:()=>el.current,getCurrentTime:()=>el.current?.currentTime||0,
        seek:(target)=>{window.fixtureMetrics.seeks.push(target);el.current.currentTime=target},
        play:()=>el.current.play(),pause:()=>el.current.pause(),toggle:()=>el.current.paused?el.current.play():el.current.pause()}),[]);
      return <video key={play.contentId} ref={el} src='/fixture.webm' muted loop autoPlay width='320'/>});`,
};

async function fixtureBundle() {
  return build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    nodePaths: [path.join(root, 'frontend/node_modules')],
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React,{Profiler} from 'react';import {createRoot} from 'react-dom/client';
      import PianoVideoPlayer from './${player}';
      window.fixtureMetrics={seeks:[],events:[],commits:[],frames:[],longTasks:[],generations:0,disposed:0};
      let last=performance.now();function frame(t){window.fixtureMetrics.frames.push(t-last);last=t;requestAnimationFrame(frame)}requestAnimationFrame(frame);
      new PerformanceObserver(list=>{for(const e of list.getEntries())window.fixtureMetrics.longTasks.push(e.duration)}).observe({type:'longtask',buffered:true});
      const root=createRoot(document.getElementById('root'));
      window.fixtureMount=(id)=>root.render(<Profiler id='piano' onRender={(id,phase,actual)=>window.fixtureMetrics.commits.push({phase,actual})}>
        <PianoVideoPlayer key={id} lecture={{plex:'fixture-'+id,label:'Fixture lesson',userPlayhead:0}} onBack={()=>{}} engagementGateEnabled={false}/></Profiler>);
      window.fixtureUnmount=()=>root.render(null);window.fixtureMount(0);`,
    },
    plugins: [{ name: 'fixture-boundaries', setup(b) {
      if (process.env.PIANO_PROFILE_BASELINE_REF) b.onLoad({filter:/PianoVideoPlayer\.jsx$/},async()=>({
        contents:(await promisify(execFile)('git',['show',`${process.env.PIANO_PROFILE_BASELINE_REF}:${player}`],{cwd:root})).stdout,
        loader:'jsx',resolveDir:path.dirname(path.join(root,player)),
      }));
      b.onResolve({ filter: /.*/ }, (args) => {
        const entry = Object.entries(mocks).find(([suffix]) => args.path.endsWith(suffix));
        return entry ? { path: entry[0], namespace: 'fixture' } : null;
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
      b.onLoad({ filter: /\.(scss|css)$/ }, () => ({ contents: '', loader: 'js' }));
    } }],
  });
}

test('fixture piano sequence records presentation, renders, media generations and bounded intents', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const mutations = [];
  const rejected = [];
  const errors = [];
  const bundle = await fixtureBundle();
  // Existing test.mp4 is a text placeholder; generate deterministic decodable media in a temporary fixture directory.
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'piano-fixture-'));
  let video;
  try {
    const fixturePath = path.join(fixtureDir, 'fixture.webm');
    await promisify(execFile)('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','120','-c:v','libvpx','-deadline','realtime','-cpu-used','8','-b:v','100k',fixturePath]);
    video = await readFile(fixturePath);
  } finally { await rm(fixtureDir, { recursive: true, force: true }); }
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="root"></div><script src="/fixture.js"></script>');
    } else if (req.method === 'GET' && req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js') || f.path === '<stdout>').text);
    } else if (req.method === 'GET' && req.url === '/fixture.webm') {
      res.setHeader('Content-Type', 'video/webm');res.setHeader('Accept-Ranges','bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]),video.length-1) : video.length-1;
      if(range){res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${video.length}`);}
      res.setHeader('Content-Length',end-start+1);res.end(video.subarray(start,end+1));
    } else if (req.method === 'POST' && req.url === '/api/v1/play/log') {
      let body=''; req.on('data',chunk=>{body+=chunk});req.on('end',()=>{
        mutations.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end('{"userProgress":{"credit":null}}');
      });
    } else { rejected.push({method:req.method,url:req.url});res.writeHead(403);res.end('Unmocked fixture request'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Block cross-origin traffic too: a dependency cannot silently contact a real service.
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin+'/')) return route.continue();
    rejected.push({method:route.request().method(),url:route.request().url()});return route.abort();
  });
  await page.addInitScript(() => {
    // Track the named media callbacks owned by PianoVideoPlayer/useABLoop.
    // React's native event delegation remains the framework's responsibility.
    const records = new Map();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const owned = (el, fn) => el instanceof HTMLMediaElement
      && ['onTime','onSeeked','onPlay','onPause','onPlaying','onMeta','onEnded'].includes(fn?.name);
    EventTarget.prototype.addEventListener = function(type, fn, options) {
      if (owned(this, fn)) { if (!records.has(this)) records.set(this, new Set()); records.get(this).add(fn); }
      return add.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function(type, fn, options) {
      if (owned(this, fn)) records.get(this)?.delete(fn);
      return remove.call(this, type, fn, options);
    };
    window.fixtureMediaHandlers = () => [...records.values()].map(set => set.size);
  });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    await expect(page.getByRole('button', { name: 'Forward 30 seconds', exact: true })).toBeVisible();
    await expect.poll(()=>page.locator('video').evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(2);
    expect(await page.locator('video').evaluate(el=>el.duration)).toBe(120);
    // profile 3 identical local sequences; this is not the 20-sequence hardware gate.
    const sequences=[];
    for(let sequence=0;sequence<3;sequence++) {
      if(sequence) await page.evaluate(id=>window.fixtureMount(id),sequence);
      await expect.poll(()=>page.evaluate(()=>window.fixtureMetrics.generations)).toBe(sequence+1);
      await expect.poll(()=>page.locator('video').evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(2);
      // Wait for the real media resolver poll and normal presentation, not a fabricated timeupdate.
      await expect.poll(()=>page.evaluate(()=>window.fixtureMetrics.events.filter(e=>e.event==='piano.lesson-practice.first-frame').length)).toBe(sequence+1);
      const before=await page.evaluate(()=>({commits:window.fixtureMetrics.commits.length,seeks:window.fixtureMetrics.seeks.length}));
      await page.evaluate(()=>{
        window.fixtureMidi();
        for(let i=0;i<9;i++)document.querySelector('[aria-label="Forward 30 seconds"]').click();
        for(let i=0;i<9;i++)document.querySelector('[aria-label="Restart from beginning"]').click();
        for(let i=0;i<9;i++)document.querySelector('[aria-label="Back 15 seconds"]').click();
      });
      await expect.poll(()=>page.locator('video').evaluate(el=>!el.seeking && el.currentTime<2)).toBe(true);
      await expect.poll(()=>page.evaluate(()=>window.fixtureMetrics.frames.length)).toBeGreaterThan(10*(sequence+1));
      const after=await page.evaluate(()=>({commits:window.fixtureMetrics.commits.length,seeks:window.fixtureMetrics.seeks.length,subscriptions:window.fixtureSubscriptions(),videos:document.querySelectorAll('video').length}));
      sequences.push({commits:after.commits-before.commits,seeks:after.seeks-before.seeks,subscriptions:after.subscriptions,videos:after.videos});
      await page.getByRole('button',{name:'Pause',exact:true}).click();
      await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Play',exact:true}).click();
    }
    await page.evaluate(()=>window.fixtureUnmount());
    await expect(page.locator('video')).toHaveCount(0);
    const metrics=await page.evaluate(()=>window.fixtureMetrics);
    const sorted=metrics.frames.slice().sort((a,b)=>a-b);
    const report={fixture:'synthetic testsrc2 320x180/30fps/120s VP8 (ffmpeg)',at:new Date().toISOString(),sequences,
      frameMs:{p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)},
      longTasks:metrics.longTasks,commits:metrics.commits.length,generations:metrics.generations,disposed:metrics.disposed,
      creditWrites:mutations.length,mediaHandlersAfterUnmount:await page.evaluate(()=>window.fixtureMediaHandlers()),rejected,errors,nativeThermal:'not available in desktop fixture',css:'omitted; no layout claims'};
    const profilePath=testInfo.outputPath('piano-fixture-profile.json');
    await writeFile(profilePath,JSON.stringify(report,null,2));
    await testInfo.attach('piano-fixture-profile',{path:profilePath,contentType:'application/json'});
    expect(errors).toEqual([]);expect(rejected).toEqual([]);
    expect(await page.evaluate(()=>window.fixtureSubscriptions())).toBe(0);
    expect(metrics.disposed).toBe(metrics.generations);
    expect(report.mediaHandlersAfterUnmount).toEqual([0,0,0]);
    for(const sequence of sequences){expect(sequence.videos).toBe(1);expect(sequence.subscriptions).toBe(2);}
    if(!process.env.PIANO_PROFILE_ONLY) for(const sequence of sequences) expect(sequence.seeks).toBeLessThanOrEqual(2);
    // All posts are captured in memory; no server response fabricates credit.
    expect(mutations.every(body=>body.userId==='fixture-learner')).toBe(true);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
