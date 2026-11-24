// Real ScorePlayer -> LearnCoach -> LearnLab -> ExerciseRun -> assessor -> outbox -> service.
// Opening a passage lands on the drill surface; there is no prepare page and no result page.
// Only hardware, roster/config, logging, and HTTP are replaced. Notation is engraved by OSMD.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pianoCoachFixture } from '../../../../../../../tests/_lib/pianoCoachFixture.mjs';
import { validateAssessment } from '../../../../portable/music/assessmentRecord.mjs';
import { PianoLearnCoachService } from '../../../../server/application/PianoLearnCoachService.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const ARTIFACTS = path.join(ROOT, '.superpowers/sdd/2026-10-26-piano-learn-adaptive-flow/browser');
const SCORE_ID = 'files:coach-journey.musicxml';
// Screenshots of the rhythm take (mid-way and its result), for a person to look at.
const SHOTS = path.join(ROOT, '.superpowers/piano-rhythm-feedback');
// A tap this late at 240 bpm (250 ms between beats) is outside the 100 ms hit window but nearer its own beat
// than the next one: yellow, late.
const LATE_MS = 112;
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${[1, 2].map((number) => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>240</per-minute></metronome></direction-type><sound tempo="240"/></direction>' : ''}${[1, 2].map((staff) => `${staff === 2 ? '<backup><duration>4</duration></backup>' : ''}${['C','D','E','F'].map((step) => `<note><pitch><step>${step}</step><octave>${staff === 1 ? 4 : 3}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`).join('')}`).join('')}</measure>`).join('')}</part></score-partwise>`;
const stubs = [
 // The ceremony curtain reads the game registry only for the game gate; its lazy games are not part of Learn.
 [/browser\/gameRegistry\.js$/, `export const getGameEntry=()=>null;`],
 [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data,at:Date.now()}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
 [/PianoKiosk\/PianoConfig\.jsx$/, `const config={ timezone:'America/Los_Angeles', keyboard:{startNote:21,endNote:108}, sheetmusic:{ defaultMode:'learn', learn:{ skipping:{ default:'open' }, certification:{ testOutFirst:false } } } }; export const usePianoKioskConfig=()=>({config}); export const usePianoKioskConfigOptional=()=>({config});`],
 [/PianoKiosk\/PianoUserContext\.jsx$/, `import {useSyncExternalStore} from 'react'; let user='learner4'; const subs=new Set(); const sub=f=>{subs.add(f);return()=>subs.delete(f)}; window.__profile=id=>{user=id;for(const f of subs)f()}; export const usePianoUser=()=>({currentUser:useSyncExternalStore(sub,()=>user,()=>user)});`],
 [/PianoKiosk\/PianoMidiContext\.jsx$/, `import {useSyncExternalStore} from 'react'; import {flushSync} from 'react-dom'; let notes=new Map();const subs=new Set(),events=new Set();const sub=f=>{subs.add(f);return()=>subs.delete(f)}; const midi={connected:true,subscribe:f=>{events.add(f);return()=>events.delete(f)},subscribeRaw:()=>()=>{},pressNote:()=>{},releaseNote:()=>{},sendNoteAt:(note)=>{(window.__audio??=[]).push(note)},sendNoteOffAt:()=>{},sendPanic:()=>{}}; window.__hold=midis=>{const now=Date.now();const before=notes;flushSync(()=>{notes=new Map(midis.map(m=>[m,before.get(m)??{timestamp:now,velocity:80}]));for(const f of subs)f();});for(const midi of midis) if(!before.has(midi))for(const f of events)f({type:'note_on',note:midi,velocity:80,timeStamp:performance.now()});};export const usePianoMidi=()=>midi;export const usePianoMidiNotes=()=>({activeNotes:useSyncExternalStore(sub,()=>notes,()=>notes),noteHistory:[],sustainPedal:false});`],
 [/PianoKiosk\/PianoBreadcrumbContext\.jsx$/, `export const usePianoBreadcrumb=()=>{};`],
 [/PianoKiosk\/usePianoPlayback\.js$/, `export const usePianoPlayback=()=>({setPlaying:()=>{}});`],
 [/PianoKiosk\/useReloadGuard\.js$/, `export default ()=>{};`],
 [/SheetMusic\/useMetronomeClick\.js$/, `export const useMetronomeClick=()=>{}; export default useMetronomeClick;`],
 [/lib\/api\.mjs$/, `export const DaylightAPI=(url,body={},method='GET')=>window.__request({url,body,method});export const DaylightAPIText=async()=>window.__xml;export const DaylightMediaPath=p=>p;export const DaylightImagePath=p=>p;export const ContentDisplayUrl=p=>p;export const DaylightHostPath=()=>'';export const DaylightStatusCheck=async()=>({});export const DaylightWebsocketSubscribe=()=>{};export const DaylightWebsocketUnsubscribe=()=>{};export const normalizeImageUrl=u=>u;`],
];
let browser, js, css;
beforeAll(async () => {
 const sheets = new Set(); const esbuild = require('esbuild');
 const bundle = await esbuild.build({ stdin:{ contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import ScorePlayer from './ScorePlayer.jsx';window.__mount=()=>{window.__root?.unmount();window.__root=createRoot(document.getElementById('root'));window.__root.render(<MemoryRouter><ScorePlayer score={{id:${JSON.stringify(SCORE_ID)},title:'Coach journey',musicXml:window.__xml}}/></MemoryRouter>);};window.__mount();`, resolveDir: HERE, loader:'jsx' }, bundle:true,write:false,format:'iife',nodePaths:[path.resolve(HERE,'../../../../../../../frontend/node_modules')],jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"MODE":"production","DEV":false,"PROD":true}'},logLevel:'silent', plugins:[{name:'io-only',setup(build){
  build.onResolve({filter:/\.(scss|css)$/},args=>{ const file=args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):require.resolve(args.path);sheets.add(file);return{path:file,namespace:'sheet'};});
  build.onLoad({filter:/.*/,namespace:'sheet'},()=>({contents:'',loader:'js'}));
  build.onLoad({filter:/\.(jsx|js|mjs)$/},args=>{for(const [pattern,contents] of stubs)if(pattern.test(args.path))return{contents,loader:'jsx'};
    if(args.path.endsWith('/ui/icons/Icon.jsx')){const dir=path.join(path.dirname(args.path),'svg');const files=[...fs.readdirSync(dir).filter(f=>f.endsWith('.svg')),...fs.readdirSync(path.join(dir,'generated')).filter(f=>f.endsWith('.svg')).map(f=>`generated/${f}`)];const assets=Object.fromEntries(files.map(f=>[`./svg/${f}`,fs.readFileSync(path.join(dir,f),'utf8')]));return{contents:fs.readFileSync(args.path,'utf8').replace(/import\.meta\.glob\([^\n]+\)/,JSON.stringify(assets)),loader:'jsx'};}return null;});
 }}] });js=bundle.outputFiles[0].text;
 const sass = await import('sass-embedded'); const out=[];
 for(const file of new Set([path.join(ROOT,'__capabilities/music-notation/browser/styles/tokens.scss'),path.join(ROOT,'__app_modules/learning/piano/browser/pianoTokens.scss'),path.join(ROOT,'__app_modules/learning/piano/browser/PianoApp.scss'),...sheets]))out.push(file.endsWith('.css')?fs.readFileSync(file,'utf8'):(await sass.compileAsync(file,{loadPaths:[path.join(ROOT,'frontend'),path.dirname(file)]})).css);
 css=out.join('\n').replace(/@font-face\s*\{[^}]*\}/g,'');
 const {chromium}=await import('playwright');browser=await chromium.launch();fs.mkdirSync(ARTIFACTS,{recursive:true});fs.mkdirSync(SHOTS,{recursive:true});
},180000);
afterAll(async()=>{await browser?.close();});
async function open(viewport={width:1280,height:800}){
 const f=pianoCoachFixture(); f.pieceNotes=[]; const service=new PianoLearnCoachService({...f,skipping:SKIPPING,pieceLog:{note:(entry)=>{f.pieceNotes.push(entry);return entry;}}});const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__request',async({url,body,method})=>{
  const [,user]=url.match(/users\/([^/]+)/)??[];
  if(f.offline && method==='POST')throw new Error('offline');
  if(url.includes('/preferences'))return{};
  if(url.includes('/attempts')){const checked=validateAssessment(body);if(!checked.valid)throw new Error(checked.errors.join('; '));f.attempts.set(body.attempt_id,{...body,user_id:user});return{attempt_id:body.attempt_id};}
  const [,key]=url.match(/practice\/([^/?]+)/)??[];
  if(url.includes('/coach'))return method==='POST'?service.record(user,key,body):service.get(user,key);
  if(key)return f.datastore.getPractice(user,key);return{};
 });
 await page.route('http://learn.test/**',route=>route.fulfill({status:200,body:'<!doctype html>'}));await page.goto('http://learn.test');
 await page.setContent(`<style>${css}html,body{margin:0}#root{height:calc(100vh - 70px);display:flex;flex-direction:column;min-height:0}</style><div class="piano-app"><header style="height:70px"></header><div id="root"></div></div>`);
 await page.evaluate(value=>{window.__xml=value},xml);await page.addScriptTag({content:js});
 return{page,f,errors};
}
// These journeys walk the ladder from its first step, so test-out-first is off here (it is covered in the coach unit tests).
// They go straight to score tempo, which the default skipping mode holds behind Silver; kiosk and server agree on `open`.
const SKIPPING={ default:'open' };
const click=async(page,name)=>{await page.getByRole('button',{name,exact:true}).click({timeout:30000});};
const armed=async(page)=>{await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(600);};
// Open the passage (a tap on the path's target token, the one with the play disc), then tap a set of the drill to run that step.
const openPassage=async(page)=>{await page.locator('.piano-passage-path__token[data-target]').click({timeout:30000});await armed(page);};
const openStep=async(page,step)=>{await openPassage(page);await page.locator('button.drill-cluster').and(page.getByRole('button',{name:STEP_NAMES[step],exact:true})).click();await page.locator('.piano-learn-lab__task').filter({hasText:STEP_NAMES[step]}).waitFor();await armed(page);};
// The Gold lap's steps are drawn only once the passage is Bronze (laps): earn it with a clean check, land back on the
// score, then open the path's "A in time" token (it opens on the rhythm step) and tap the step wanted.
const goldTake=[[60,48],[62,50],[64,52],[65,53],[60,48],[62,50],[64,52],[65,53]].flatMap(([r,l])=>[[r],[r,l],[l],[]]);
const openGold=async(page,step)=>{await openStep(page,'On your own');
 await page.evaluate(async(list)=>{for(const frame of list){window.__hold(frame);await new Promise(r=>setTimeout(r,70));}},goldTake);
 await curtain(page,'Piece Silver!').waitFor({timeout:15000});await page.locator('.piano-learn-coach').waitFor({state:'detached',timeout:20000});
 await page.getByRole('button',{name:'A in time, bars 1–2',exact:true}).click({timeout:15000});await page.locator('.piano-learn-lab__task').filter({hasText:'Tap the rhythm'}).waitFor();await armed(page);
 if(step!=='Rhythm'){await page.locator('button.drill-cluster').and(page.getByRole('button',{name:STEP_NAMES[step],exact:true})).click();await page.locator('.piano-learn-lab__task').filter({hasText:STEP_NAMES[step]}).waitFor();await armed(page);}};
const STEP_NAMES={'On your own':'Play it on your own','100%':'Play at score tempo','Rhythm':'Tap the rhythm'};
const card=(page,text)=>page.locator('.rep-card').filter({hasText:text});
// Silver and Gold close the drill's curtain; its verdict carries the word.
const curtain=(page,word)=>page.locator('.gate-ceremony').filter({has:page.locator('.gate-ceremony__word',{hasText:word})});
// A timed take counts in on any key, then expects eight beats at 240 BPM.
async function playTimed(page){
 const before=await page.evaluate(()=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length);
 await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
 await page.waitForFunction((n)=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length>n,before);
 await page.evaluate(async()=>{const log=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);const downbeat=log.at+log.data.countdownRemainingMs;for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,Math.max(0,downbeat+i*250-Date.now())));window.__hold([[60,48],[62,50],[64,52],[65,53]][i%4]);await new Promise(r=>setTimeout(r,75));window.__hold([]);}});
}
describe('real Learn journey',()=>{
 const playFree=(page,frames)=>page.evaluate(async(list)=>{for(const frame of list){window.__hold(frame);await new Promise(r=>setTimeout(r,70));}},frames);
 // Each position: right hand first, both down together, right lifts while left still holds, then all up.
 const cleanTake=[[60,48],[62,50],[64,52],[65,53],[60,48],[62,50],[64,52],[65,53]].flatMap(([r,l])=>[[r],[r,l],[l],[]]);
 it('lands on the drill surface with the passage contained and nothing to scroll',async()=>{
  const{page,f,errors}=await open();try{
   await openPassage(page);await page.screenshot({path:path.join(ARTIFACTS,'drill-open.png')});
   expect(await page.locator('.piano-learn-lab__task').innerText()).toBe('Find the right-hand notes');
   expect(await page.locator('.piano-learn-lab__identity').innerText()).toBe('Bars 1–2');
   expect(await page.getByRole('button',{name:'Start practice'}).count()).toBe(0);
   // Only the Bronze lap's steps (the hands, together, the check), headed by the passage's own token.
   expect(await page.locator('.drill-cluster').count()).toBe(4);
   expect(await page.locator('.drill-progress__head').getAttribute('aria-label')).toBe('A, steps to Bronze');
   expect(await page.locator('.piano-passage-path__token').count()).toBe(1);
   const text=await page.locator('.piano-learn-coach').innerText();
   for(const banned of ['Segment','Practicing as','Progress saved','previously earned','Connect the piano'])expect(text).not.toContain(banned);
   // The engraving sits inside its paper, and nothing on the screen scrolls.
   const paper=await page.locator('.piano-exercise-run__stage').boundingBox();const ink=await page.locator('.piano-exercise-run__stage .musicxml-renderer__svg svg').boundingBox();
   expect(ink.y).toBeGreaterThanOrEqual(paper.y);expect(ink.y+ink.height).toBeLessThanOrEqual(paper.y+paper.height+1);expect(ink.x+ink.width).toBeLessThanOrEqual(paper.x+paper.width+1);
   const scrollers=await page.evaluate(()=>[...document.querySelectorAll('.piano-learn-coach, .piano-learn-coach *')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).length);
   expect(scrollers).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);
   // Opening a passage is not choosing it: nothing is sent until a note is played.
   expect(f.records.size).toBe(0);expect(errors).toEqual([]);
  }finally{await page.close();}
 },90000);
 it('draws the rhythm step as one line of X noteheads, any key, before the metronome',async()=>{
  const{page,errors}=await open();try{
   await openGold(page,'Rhythm');
   expect(await page.locator('.piano-learn-lab__task').innerText()).toBe('Tap the rhythm');
   await page.screenshot({path:path.join(ARTIFACTS,'rhythm-step.png')});
   // Every notehead is the X glyph on one line per staff: one distinct vertical position per staff.
   const heads=await page.locator('.piano-exercise-run__stage .vf-notehead').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return Math.round(b.top);}));
   expect(heads.length).toBeGreaterThan(0);
   expect(new Set(heads).size).toBeLessThanOrEqual(2);
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },90000);
 it('gives the rhythm take the timed steps\' live feedback: cursor on the clock, X heads judged as they pass, marks after',async()=>{
  const{page,errors}=await open();try{
   await openGold(page,'Rhythm');
   const stage='.piano-exercise-run__stage';
   // The X heads, in score order (left to right), and what each wears now.
   const heads=()=>page.locator(`${stage} .vf-stavenote`).evaluateAll(els=>els.map(el=>({x:Math.round(el.getBoundingClientRect().left),verdict:el.getAttribute('data-verdict'),cls:[...el.classList].find(c=>c.startsWith('piano-note-verdict-'))??null})).sort((a,b)=>a.x-b.x));
   const cursorX=()=>page.locator(`${stage} .piano-score-passage__cursor`).evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().left)));
   // Count in on any key, as the timed steps do.
   const before=await page.evaluate(()=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length);
   await page.evaluate(async()=>{window.__hold([30]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
   await page.waitForFunction((n)=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length>n,before);
   const downbeat=await page.evaluate(()=>{const log=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);return log.at+log.data.countdownRemainingMs;});
   // Eight beats, 250 ms apart, every tap on a pitch the score does not have: on time, except beat 4 at the
   // margin (late) and beat 5 never tapped.
   const OFFSET=[0,0,0,LATE_MS,null,0,0,0];
   // Each tap is timed by sleeping to just short of its moment and then holding the thread until it, so a
   // busy machine's late timer cannot carry the margin tap out of its beat's reach.
   const take=page.evaluate(async({downbeat,offsets})=>{for(let i=0;i<offsets.length;i++){if(offsets[i]==null)continue;const at=downbeat+i*250+offsets[i];await new Promise(r=>setTimeout(r,Math.max(0,at-40-Date.now())));while(Date.now()<at);window.__hold([i%2?91:23]);await new Promise(r=>setTimeout(r,60));window.__hold([]);}},{downbeat,offsets:OFFSET});
   // Early in the take: the cursor is on the score, and moves with the clock.
   await page.waitForFunction((t)=>Date.now()>=t,downbeat+80);const firstCursor=await cursorX();
   // Mid-way, past beat 5's window: beats 1-3 green, 4 yellow, 5 missed, the rest not judged yet.
   await page.waitForFunction((t)=>Date.now()>=t,downbeat+5*250+20);
   const mid=await heads();const midCursor=await cursorX();
   await page.screenshot({path:path.join(SHOTS,'rhythm-take-midway.png')});
   expect(firstCursor).toHaveLength(1);expect(midCursor).toHaveLength(1);expect(midCursor[0]).toBeGreaterThan(firstCursor[0]);
   // Two staves: each beat is two X heads at one x.
   const byBeat=(list)=>{const xs=[...new Set(list.map(h=>h.x))].sort((a,b)=>a-b);return xs.map(x=>list.filter(h=>h.x===x).map(h=>h.cls));};
   const midBeats=byBeat(mid);expect(midBeats).toHaveLength(8);
   expect(midBeats.slice(0,3).flat()).toEqual(Array(6).fill('piano-note-verdict-hit'));
   expect(midBeats[3]).toEqual(['piano-note-verdict-late','piano-note-verdict-late']);
   expect(midBeats[4]).toEqual(['piano-note-verdict-unplayed','piano-note-verdict-unplayed']);
   expect(midBeats.slice(6).flat()).toEqual([null,null,null,null]);
   await take;
   // The result: every head judged by colour; only notes to fix carry a mark (◂ ▸ ○ ×), a right note none (2026-11-24).
   await page.waitForFunction(()=>document.querySelectorAll('.piano-exercise-run__stage .piano-score-passage__drift').length>=4,null,{timeout:10000});
   const done=byBeat(await heads());
   expect(done.map(beat=>beat[0])).toEqual(['hit','hit','hit','late','unplayed','hit','hit','hit'].map(k=>`piano-note-verdict-${k}`));
   const marks=await page.locator(`${stage} .piano-score-passage__drift`).evaluateAll(els=>els.map(el=>el.textContent));
   expect(marks.filter(m=>m==='✓')).toHaveLength(0);expect(marks.filter(m=>m==='▸')).toHaveLength(2);expect(marks.filter(m=>m==='○')).toHaveLength(2);
   // Every verdict mark is on the paper, beside a notehead: never under a stem tip, never past the edge.
   const placed=await page.evaluate(()=>{const svg=document.querySelector('.piano-exercise-run__stage .musicxml-renderer__svg svg');const paper=svg.getBoundingClientRect();
    const heads=[...svg.querySelectorAll('.vf-notehead')].map(h=>h.getBoundingClientRect());
    return [...svg.querySelectorAll('.piano-score-passage__drift')].map(m=>{const b=m.getBoundingClientRect();const cy=(b.top+b.bottom)/2;
     const near=Math.min(...heads.filter(h=>Math.abs((h.left+h.right)/2-(b.left+b.right)/2)<b.width+4).map(h=>Math.min(Math.abs(cy-h.top),Math.abs(cy-h.bottom))));
     return{inside:b.top>=paper.top-0.5&&b.bottom<=paper.bottom+0.5,near,space:heads[0]?heads[0].height:10};});});
   expect(placed).toHaveLength(4);
   for(const mark of placed){expect(mark.inside).toBe(true);expect(mark.near).toBeLessThan(mark.space*2);}
   // The judged colours are really painted on the X glyphs.
   const fills=await page.locator(`${stage} .piano-note-verdict-hit .vf-notehead path`).evaluateAll(els=>[...new Set(els.map(el=>getComputedStyle(el).fill))]);
   expect(fills).toEqual(['rgb(0, 150, 70)']);
   await page.screenshot({path:path.join(SHOTS,'rhythm-take-result.png')});
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },90000);
 it('certifies Silver from a clean hints-off take with hands held across each other',async()=>{
  const{page,f,errors}=await open();try{
   await openStep(page,'On your own');await playFree(page,cleanTake);
   // A one-passage piece: its Bronze is the whole piece played through, so the curtain says Piece Silver and the rail turns with it.
   await curtain(page,'Piece Silver!').waitFor({timeout:15000});await page.waitForTimeout(2600);await page.screenshot({path:path.join(ARTIFACTS,'silver-earned.png')});
   expect(await page.getByRole('status',{name:'You played the whole piece!'}).count()).toBe(1);expect(await page.locator('.gate-ceremony__mark .coin-icon[data-metal="silver"]').count()).toBe(1);
   expect(await page.locator('.rep-card').count()).toBe(0);
   expect(await page.locator('.piano-passage-path__token[data-state="silver"][data-flip="silver"]').count()).toBe(1);
   // The verdict is solid while it is held: nothing on the curtain is see-through.
   expect(await page.locator('.gate-ceremony__verdict').evaluate((el)=>getComputedStyle(el).opacity)).toBe('1');
   // The curtain parts onto what is next, then hands back to the score.
   expect(await page.locator('.gate-ceremony__behind').innerText()).toMatch(/Next\s+Go for Gold/i);
   // Back on the score (the drill screen's path names the same task, so wait for the drill to go first).
   await page.locator('.piano-learn-coach').waitFor({state:'detached',timeout:15000});await page.getByRole('button',{name:'A in time, bars 1–2',exact:true}).waitFor({timeout:15000});expect(await page.locator('.gate-ceremony').count()).toBe(0);
   await expect.poll(()=>f.attempts.size).toBe(1);
   const attempt=[...f.attempts.values()][0];expect(attempt.diagnostics).toMatchObject({matched_notes:16,wrong_notes:0,missed_notes:0});expect(attempt.criteria.cleanliness).toBe(1);
   const record=[...f.records.values()][0];expect(record.learnCoach.summary.silver).toBeGreaterThan(0);
   expect(await page.locator('.piano-passage-path__token[data-state="silver"]').count()).toBe(1);
   expect(f.pieceNotes).toEqual([expect.objectContaining({userId:'learner4',scoreId:SCORE_ID,level:'silver',passages:1})]);
   expect((await page.evaluate(()=>window.__logs)).filter(l=>l.event==='piano.learn.celebrate').map(l=>l.data)).toEqual([expect.objectContaining({scope:'piece',level:'silver'})]);
   await page.screenshot({path:path.join(ARTIFACTS,'silver-landing.png')});
   await page.getByRole('button',{name:'A in time, bars 1–2'}).waitFor();
   await page.evaluate(()=>window.__mount());await page.getByRole('button',{name:'A in time, bars 1–2'}).waitFor();await page.waitForTimeout(400);
   // The score itself celebrates nothing: no banner, no sentence, and nothing again on a reload.
   expect(await page.getByText(/whole piece/i).count()).toBe(0);expect(await page.locator('.gate-ceremony').count()).toBe(0);
   expect((await page.evaluate(()=>window.__logs)).filter(l=>l.event==='piano.learn.celebrate')).toHaveLength(1);
   // The path's next token opens the passage on one tap, on its next Gold step (the rhythm, before the metronome).
   expect(await page.locator('.piano-passage-path__caption').innerText()).toBe('A in time');
   await click(page,'A in time, bars 1–2');await page.locator('.piano-learn-lab__task').filter({hasText:'Tap the rhythm'}).waitFor();await page.screenshot({path:path.join(ARTIFACTS,'silver-certified.png')});
   // The Gold lap's steps only, none done yet, headed "A · steps to Gold".
   expect(await page.locator('.drill-cluster').count()).toBe(7);expect(await page.locator('.drill-cluster[data-done]').count()).toBe(0);
   expect(await page.locator('.drill-progress__head').getAttribute('aria-label')).toBe('A, steps to Gold');
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },90000);
 it('offers a retry, then a drill and a way out, after missed Silver checks',async()=>{
  const{page,errors}=await open();try{
   await openStep(page,'On your own');const miss=[[60,48],[],...[[62,50],[64,52],[65,53],[60,48],[62,50],[64,52],[65,53]].flatMap((pair)=>[[70],[],[71],[],pair,[]])];
   const stage=()=>page.locator('.piano-exercise-run__stage').boundingBox();
   const before=await stage();
   await playFree(page,miss);await page.locator('.piano-exercise-run__result').filter({hasText:'Almost on your own'}).waitFor({timeout:15000});await page.screenshot({path:path.join(ARTIFACTS,'silver-miss.png')});
   expect(await page.locator('.rep-card').count()).toBe(0);
   // The result is docked in the rail's slot: the music does not move or resize when a take ends.
   expect(await stage()).toEqual(before);
   // (Mark placement is checked on the rhythm take, whose late and missed notes carry marks.)
   // The card never covers the score: it sits under the stage, inside the kiosk's 800 px, with nothing scrolled out of
   // sight, and every verdict mark is still the topmost thing at its own position.
   const docked=async()=>{const card=await page.locator('.piano-exercise-run__result.is-docked').boundingBox();
    expect(card.y).toBeGreaterThanOrEqual(before.y+before.height-0.5);expect(card.y+card.height).toBeLessThanOrEqual(800.5);
    expect(await page.locator('.piano-exercise-run__result.is-docked').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
    // Probed on the judged noteheads (a right note carries no mark since 2026-11-24).
    const seen=await page.evaluate(()=>[...document.querySelectorAll('.piano-exercise-run__stage [class*="piano-note-verdict-"]')].map(m=>{const b=m.getBoundingClientRect();
     const hit=document.elementFromPoint((b.left+b.right)/2,(b.top+b.bottom)/2);return Boolean(hit&&(hit===m||m.contains(hit)||hit.closest('.piano-exercise-run__stage')));}));
    expect(seen.length).toBeGreaterThan(0);expect(seen.every(Boolean)).toBe(true);
    const primary=await page.locator('.piano-exercise-run__result-actions button.is-primary').boundingBox();
    expect(primary.height).toBeGreaterThanOrEqual(48);expect(primary.y).toBeGreaterThanOrEqual(card.y-0.5);expect(primary.y+primary.height).toBeLessThanOrEqual(card.y+card.height+0.5);};
   await docked();
   expect(await page.getByRole('button',{name:'Try again'}).count()).toBe(1);
   expect(await page.locator('.piano-exercise-run__onward').getAttribute('aria-label')).toContain('pedal to try again');
   // Any key takes the primary button, so the child never has to reach for the glass.
   const key=()=>page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,80));window.__hold([]);await new Promise(r=>setTimeout(r,80));});
   const logged=(event)=>page.evaluate((name)=>window.__logs.filter(l=>l.event===name).map(l=>l.data),event);
   // A key counts once the card has been up long enough to be read.
   const cardArmed=()=>page.locator('.piano-exercise-run__result[data-result-armed="true"]').waitFor({timeout:15000});
   await cardArmed();
   await key();await armed(page);expect(await page.locator('.piano-exercise-run__result').count()).toBe(0);
   expect(await stage()).toEqual(before);
   await playFree(page,miss);
   // A key played on, ~100 ms after the take ended: no repeat, and the miss is still recorded.
   await key();
   expect((await logged('piano.exercise-retry')).length).toBe(1);
   await expect.poll(async()=>(await logged('piano.learn.coach.take')).length,{timeout:15000}).toBe(2);
   await page.getByRole('button',{name:'Come back to this later'}).waitFor({timeout:15000});await page.screenshot({path:path.join(ARTIFACTS,'silver-second-miss.png')});
   expect(await page.getByRole('button',{name:/^Practice /}).count()).toBeGreaterThan(0);
   await cardArmed();await docked();
   expect(await page.locator('.piano-exercise-run__onward').getAttribute('aria-label')).toMatch(/pedal to practice /);
   const paper=await stage();expect(paper.height).toBeGreaterThan(300);
   // The key takes the recommended smaller practice, not a repeat of the take that missed.
   await key();await armed(page);
   expect((await page.evaluate(()=>window.__logs)).filter(l=>l.event==='piano.exercise-retry').map(l=>l.data.action)).toEqual(['host','host']);
   expect(await page.locator('.piano-learn-lab__identity').innerText()).toMatch(/^Bars? \d/);expect(errors).toEqual([]);
  }finally{await page.close();}
 },90000);
 it('grades two-hand timed notes, saves each take once, earns Gold and resumes after remount',async()=>{
  const{page,f,errors}=await open();try{
   await openGold(page,'100%');await page.screenshot({path:path.join(ARTIFACTS,'tablet-timed-ready.png')});
   await playTimed(page);await card(page,'Rep 1 of 2').waitFor({timeout:15000});await expect.poll(()=>f.attempts.size).toBe(2);
   const attempt=[...f.attempts.values()].at(-1);expect(attempt.diagnostics).toMatchObject({matched_notes:16,wrong_notes:0,missed_notes:0});
   expect(attempt.criteria.placement).toBeGreaterThanOrEqual(.8);
   await page.screenshot({path:path.join(ARTIFACTS,'tablet-rep-card.png')});
   // The second rep is the same step, mounted under the card, on the true MIDI input path.
   await page.locator('.rep-card').waitFor({state:'detached',timeout:10000});await armed(page);
   await playTimed(page);await curtain(page,'All Gold!').waitFor({timeout:15000});await page.waitForTimeout(2600);await page.screenshot({path:path.join(ARTIFACTS,'tablet-gold.png')});
   // The passage's Bronze coin turns into the gold one: exactly one gold coin, and the bronze one it leaves.
   expect(await page.locator('.gate-ceremony__mark .coin-icon[data-metal="gold"]:not(.piano-passage-coin--bronze)').count()).toBe(1);
   await page.locator('.piano-passage-path__token[data-state="gold"]').waitFor({timeout:15000});await expect.poll(()=>f.attempts.size).toBe(3);
   await page.locator('.piano-learn-coach').waitFor({state:'detached',timeout:15000});await page.getByRole('button',{name:'Play A again, bars 1–2',exact:true}).waitFor({timeout:15000});
   await page.evaluate(()=>window.__mount());await page.getByRole('button',{name:'Play A again, bars 1–2',exact:true}).waitFor();await openPassage(page);
   // Every step of the lap it reopens on is done.
   const shown=await page.locator('.drill-cluster').count();expect(shown).toBeGreaterThan(0);
   expect(await page.locator('.drill-cluster[data-done]').count()).toBe(shown);expect(errors).toEqual([]);
  }catch(error){fs.writeFileSync(path.join(ARTIFACTS,'failure.json'),JSON.stringify({errors,attempts:[...f.attempts.values()],text:await page.locator('body').innerText(),logs:await page.evaluate(()=>window.__logs)},null,2));await page.screenshot({path:path.join(ARTIFACTS,'failure.png'),fullPage:true});throw error;}finally{await page.close();}
 },90000);
 // The field take of 2026-11-20 (Jingle Bells bar 3 at 56 bpm), which used to be scored and named "one beat late"; it now goes back to the count.
 // Its notes:: steady, in order, every note one click late and then
 // +0.20/+0.11/+0.11/+0.08 s of it (1.07 s between notes). Replayed here at the same share of this passage's note
 // spacing (250 ms). At 240 bpm the count-in clicks every half note, so "one beat late" is one click: 500 ms.
 it('sends the field take (one beat late) back to the count instead of failing it',async()=>{
  const{page,f,errors}=await open();try{
   await openGold(page,'100%');
   const before=await page.evaluate(()=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length);
   await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
   await page.waitForFunction((n)=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length>n,before);
   await page.evaluate(async()=>{const log=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);const downbeat=log.at+log.data.countdownRemainingMs;
    const late=[0.20,0.11,0.11,0.08].map(s=>Math.round(s/1.07*250));
    for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,Math.max(0,downbeat+500+i*250+late[i%4]-Date.now())));window.__hold([[60,48],[62,50],[64,52],[65,53]][i%4]);await new Promise(r=>setTimeout(r,75));window.__hold([]);}});
   // A first note a whole beat late is a MISSED CUE: the take is thrown back to the count and counted in again, not
   // played on and failed (entry-late naming survives only after three restarts in a row; see the unit tests).
   await page.waitForFunction(()=>document.body.innerText.includes('You missed the cue'),null,{timeout:15000,polling:50});await page.screenshot({path:path.join(ARTIFACTS,'cue-missed.png')});
   await expect.poll(async()=>(await page.evaluate(()=>window.__logs)).filter(l=>l.event==='piano.exercise-cue-missed').length,{timeout:15000}).toBeGreaterThanOrEqual(1);
   await expect.poll(async()=>(await page.evaluate(()=>window.__logs)).filter(l=>l.event==='piano.exercise-countdown-started'&&l.data?.reason==='missed-cue').length,{timeout:15000}).toBeGreaterThanOrEqual(1);
   // Nothing was scored or saved (only the Bronze check before it), and no result card or smaller task was offered.
   expect(f.attempts.size).toBe(1);
   expect(await page.locator('.piano-exercise-run__result').count()).toBe(0);
   expect(await page.getByRole('button',{name:/slower|^Practice /}).count()).toBe(0);
   expect(errors).toEqual([]);
  }catch(error){fs.writeFileSync(path.join(ARTIFACTS,'failure.json'),JSON.stringify({errors,text:await page.locator('body').innerText(),logs:await page.evaluate(()=>window.__logs)},null,2));await page.screenshot({path:path.join(ARTIFACTS,'failure.png'),fullPage:true});throw error;}finally{await page.close();}
 },90000);
 it('retries a saved musical success after offline failure without mixing profiles',async()=>{
  const{page,f,errors}=await open();try{
   await openGold(page,'100%'); f.offline=true; await playTimed(page);
   // The musical success is shown whatever the network does; the save trouble sits beside it.
   await card(page,'Rep 1 of 2').waitFor({timeout:15000});await page.locator('.rep-card').waitFor({state:'detached',timeout:10000});
   await page.getByText('Progress not saved',{exact:true}).waitFor({timeout:15000});
   expect(f.attempts.size).toBe(1);
   await page.evaluate(()=>window.__profile('learner5'));await page.locator('.piano-learn-lab__task').filter({hasText:'Find the right-hand notes'}).waitFor();
   expect(await page.getByText('Progress not saved',{exact:true}).count()).toBe(0);
   f.offline=false;await page.evaluate(()=>window.__profile('learner4'));
   await expect.poll(()=>f.attempts.size,{timeout:15000}).toBe(2);
   expect([...f.attempts.values()].at(-1).user_id).toBe('learner4');expect([...f.records.keys()].some(key=>key.startsWith('learner5/')&&f.records.get(key)?.learnCoach?.evidence?.length)).toBe(false);expect(errors).toEqual([]);
  }finally{await page.close();}
 },60000);
 it('demonstrates only the chosen hands without creating an assessment and returns to the drill',async()=>{
  const{page,f,errors}=await open();try{await openPassage(page);await click(page,'Listen');
   // Listen plays inside the drill: Pause and Stop in the header, the run underneath it.
   await page.getByRole('button',{name:'Stop',exact:true}).waitFor();await page.screenshot({path:path.join(ARTIFACTS,'listen.png')});
   await page.locator('.piano-exercise-run:not([data-listening])').waitFor({timeout:15000});
   const audio=await page.evaluate(()=>window.__audio);expect(audio.length).toBe(8);expect(audio.every(note=>note>=60)).toBe(true);expect(f.attempts.size).toBe(0);expect(errors).toEqual([]);
  }finally{await page.close();}
 },60000);
 it('keeps run controls and the grand staff visible while pause freezes the timed run',async()=>{
  const{page,f,errors}=await open();try{
   await openGold(page,'100%');const saved=f.attempts.size;await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
   await page.waitForFunction(()=>window.__logs.some(l=>l.event==='piano.exercise-countdown-started'));await click(page,'Pause');
   await page.locator('.piano-exercise-run[data-phase="paused"]').waitFor();
   await page.screenshot({path:path.join(ARTIFACTS,'tablet-running-paused.png')});
   // Paused: Resume and Start over (Listen is for before a take).
   expect(await page.getByRole('button',{name:'Listen',exact:true}).count()).toBe(0);
   for(const name of ['Resume','Start over']){
    const box=await page.getByRole('button',{name,exact:true}).boundingBox();expect(box.height).toBeGreaterThanOrEqual(56);expect(box.y+box.height).toBeLessThanOrEqual(800);
   }
   const toolbar=await page.locator('.piano-learn-lab__toolbar').boundingBox();expect(toolbar.height).toBeLessThanOrEqual(84);
   const stage=await page.locator('.piano-exercise-run__stage').boundingBox();expect(stage.height).toBeGreaterThan(300);
   await page.waitForTimeout(2200);expect(f.attempts.size).toBe(saved);expect(await page.locator('.piano-exercise-run[data-phase="paused"]').count()).toBe(1);
   await click(page,'Resume');await page.locator('.piano-exercise-run[data-phase="resume-countdown"]').waitFor();
   // There is no practice chooser; a step is chosen from the sets, each a full touch target.
   expect(await page.getByRole('button',{name:'Change practice'}).count()).toBe(0);
   const sets=await page.locator('button.drill-cluster').evaluateAll(list=>list.map(el=>{const r=el.getBoundingClientRect();return{w:r.width,h:r.height,top:r.top,bottom:r.bottom,clip:el.querySelector('.drill-cluster__label').getBoundingClientRect().top>=el.closest('.piano-exercise-run__rail').getBoundingClientRect().top};}));
   expect(sets).toHaveLength(7);expect(new Set(sets.map(set=>Math.round(set.top))).size).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(sets.every(set=>set.w>=64&&set.h>=56&&set.clip)).toBe(true);
   expect(f.attempts.size).toBe(saved);expect(errors).toEqual([]);
  }finally{await page.close();}
 },90000);
 it('keeps the drill chrome usable on a narrow screen with reduced motion',async()=>{
  const{page,errors}=await open({width:600,height:800});try{await page.emulateMedia({reducedMotion:'reduce'});await click(page,'Learn A, bars 1–2');await page.locator('.piano-exercise-run').waitFor();
   await page.screenshot({path:path.join(ARTIFACTS,'narrow-drill.png'),fullPage:true});
   const metrics=await page.locator('.piano-learn-lab__toolbar button').evaluateAll(buttons=>buttons.filter(b=>b.offsetParent).map(b=>({height:b.getBoundingClientRect().height,right:b.getBoundingClientRect().right})));expect(metrics.length).toBeGreaterThanOrEqual(2);expect(metrics.every(m=>m.height>=44&&m.right<=600)).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);await page.getByRole('button',{name:'Listen',exact:true}).focus();expect(await page.getByRole('button',{name:'Listen',exact:true}).evaluate(e=>e===document.activeElement)).toBe(true);expect(errors).toEqual([]);
  }finally{await page.close();}
 },60000);
});
