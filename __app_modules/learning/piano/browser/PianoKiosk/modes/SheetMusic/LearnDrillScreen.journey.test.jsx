// The drill screen in real Chromium at the kiosk's 1280x800: the header (tempo track, click volume, state-aware
// actions), Listen inside the drill, the result in the step strip's slot, pedals as any key, and the chosen-tempo
// test-out, through the real ScorePlayer -> LearnCoach -> LearnLab -> ExerciseRun -> outbox -> service path.
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
const ARTIFACTS = path.join(ROOT, '.superpowers/2026-11-23-drill-screen');
const SCORE_ID = 'files:coach-journey.musicxml';
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${[1, 2].map((number) => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>240</per-minute></metronome></direction-type><sound tempo="240"/></direction>' : ''}${[1, 2].map((staff) => `${staff === 2 ? '<backup><duration>4</duration></backup>' : ''}${['C','D','E','F'].map((step) => `<note><pitch><step>${step}</step><octave>${staff === 1 ? 4 : 3}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`).join('')}`).join('')}</measure>`).join('')}</part></score-partwise>`;
const stubs = [
 // The ceremony curtain reads the game registry only for the game gate; its lazy games are not part of Learn.
 [/browser\/gameRegistry\.js$/, `export const getGameEntry=()=>null;`],
 [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data,at:Date.now()}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
 [/PianoKiosk\/PianoConfig\.jsx$/, `const config={ timezone:'America/Los_Angeles', keyboard:{startNote:21,endNote:108}, sheetmusic:{ defaultMode:'learn', learn:{ skipping:{ default:'open' }, certification:{ testOutFirst:false } } } }; export const usePianoKioskConfig=()=>({config}); export const usePianoKioskConfigOptional=()=>({config});`],
 [/PianoKiosk\/PianoUserContext\.jsx$/, `import {useSyncExternalStore} from 'react'; let user='learner4'; const subs=new Set(); const sub=f=>{subs.add(f);return()=>subs.delete(f)}; window.__profile=id=>{user=id;for(const f of subs)f()}; export const usePianoUser=()=>({currentUser:useSyncExternalStore(sub,()=>user,()=>user)});`],
 [/PianoKiosk\/PianoMidiContext\.jsx$/, `import {useSyncExternalStore} from 'react'; import {flushSync} from 'react-dom'; let notes=new Map();const subs=new Set(),events=new Set(),raws=new Set();window.__cc=(cc,v)=>{for(const f of raws)f({data:new Uint8Array([0xb0,cc,v])});};const sub=f=>{subs.add(f);return()=>subs.delete(f)}; const midi={connected:true,subscribe:f=>{events.add(f);return()=>events.delete(f)},subscribeRaw:f=>{raws.add(f);return()=>raws.delete(f)},pressNote:()=>{},releaseNote:()=>{},sendNoteAt:(note)=>{(window.__audio??=[]).push(note)},sendNoteOffAt:()=>{},sendPanic:()=>{}}; window.__hold=midis=>{const now=Date.now();const before=notes;flushSync(()=>{notes=new Map(midis.map(m=>[m,before.get(m)??{timestamp:now,velocity:80}]));for(const f of subs)f();});for(const midi of midis) if(!before.has(midi))for(const f of events)f({type:'note_on',note:midi,velocity:80,timeStamp:performance.now()});};export const usePianoMidi=()=>midi;export const usePianoMidiNotes=()=>({activeNotes:useSyncExternalStore(sub,()=>notes,()=>notes),noteHistory:[],sustainPedal:false});`],
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
 const {chromium}=await import('playwright');browser=await chromium.launch();fs.mkdirSync(ARTIFACTS,{recursive:true});
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
const openStep=async(page,step)=>{await openPassage(page);await page.locator('button.drill-cluster').and(page.getByRole('button',{name:STEP_NAMES[step],exact:true})).click();await page.locator('.piano-learn-lab__heading strong').filter({hasText:STEP_NAMES[step]}).waitFor();await armed(page);};
// The Gold lap's steps are drawn only once the passage is Bronze (laps): earn it with a clean check, land back on the
// score, then open the path's "A in time" token (it opens on the rhythm step) and tap the step wanted.
const goldTake=[[60,48],[62,50],[64,52],[65,53],[60,48],[62,50],[64,52],[65,53]].flatMap(([r,l])=>[[r],[r,l],[l],[]]);
const openGold=async(page,step)=>{await openStep(page,'On your own');
 await page.evaluate(async(list)=>{for(const frame of list){window.__hold(frame);await new Promise(r=>setTimeout(r,70));}},goldTake);
 await curtain(page,'Piece Silver!').waitFor({timeout:15000});await page.locator('.piano-learn-coach').waitFor({state:'detached',timeout:20000});
 await page.getByRole('button',{name:'A in time, bars 1–2',exact:true}).click({timeout:15000});await page.locator('.piano-learn-lab__heading strong').filter({hasText:'Tap the rhythm'}).waitFor();await armed(page);
 if(step!=='Rhythm'){await page.locator('button.drill-cluster').and(page.getByRole('button',{name:STEP_NAMES[step],exact:true})).click();await page.locator('.piano-learn-lab__heading strong').filter({hasText:STEP_NAMES[step]}).waitFor();await armed(page);}};
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
// A timed take at `percent` of the score's 240 BPM: any key counts in, then eight beats; `lateMs` plays every note that late.
async function playAt(page,percent=100,{lateMs=0,only=null}={}){
 const before=await page.evaluate(()=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length);
 await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
 await page.waitForFunction((n)=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length>n,before);
 await page.evaluate(async({beat,lateMs,only})=>{const log=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);const downbeat=log.at+log.data.countdownRemainingMs;for(let i=0;i<8;i++){if(only&&!only.includes(i))continue;await new Promise(r=>setTimeout(r,Math.max(0,downbeat+lateMs+i*beat-Date.now())));window.__hold([[60,48],[62,50],[64,52],[65,53]][i%4]);await new Promise(r=>setTimeout(r,75));window.__hold([]);}},{beat:60000/(240*percent/100),lateMs,only});
}
// Every band of the drill screen, by its box: none may move or resize whatever the take is doing.
const BANDS={header:'.piano-learn-lab__toolbar',tempo:'.piano-learn-lab__settings',score:'.piano-exercise-run__stage',strip:'.piano-exercise-run__rail',keys:'.piano-exercise-run__keys',path:'.piano-passage-path'};
const bands=(page)=>page.evaluate((map)=>Object.fromEntries(Object.entries(map).map(([name,sel])=>{const el=document.querySelector(sel);const b=el?.getBoundingClientRect();return[name,b?[Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]:null];})),BANDS);
const shot=(page,name)=>page.screenshot({path:path.join(ARTIFACTS,`${name}.png`)});
// The speed is one header button; its stops are in a sheet (2026-11-24).
const speedStops=async(page,sel='')=>{await page.getByRole('button',{name:/^Speed/}).click();const dialog=page.getByRole('dialog',{name:'Speed',exact:true});await dialog.waitFor();
 const out=await page.locator('.piano-learn-speed-sheet__stops button'+sel).evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')));await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});return out;};
const chooseSpeed=async(page,name)=>{await page.getByRole('button',{name:/^Speed/}).click();const dialog=page.getByRole('dialog',{name:'Speed',exact:true});await dialog.getByRole('button',{name,exact:true}).click();await dialog.waitFor({state:'detached'});};
const timedStep=async(page,index)=>{await page.locator('button.drill-cluster').nth(index).click();await page.locator('.piano-learn-lab__heading strong').filter({hasText:'Play with the beat'}).waitFor();await armed(page);};
const headerButtons=(page)=>page.locator('.piano-learn-lab__run-controls button').evaluateAll(list=>list.map(b=>b.innerText.trim()));
const logged=(page,name)=>page.evaluate((event)=>window.__logs.filter(l=>l.event===event).map(l=>l.data),name);

describe('the drill screen: header, tempo, volume, Listen, result',()=>{
 it('keeps every band fixed before, during and after a take, with state-aware actions and an icon result',async()=>{
  const{page,errors}=await open();try{
   await openGold(page,'Rhythm');
   // The Gold lap: rhythm, beat, each hand at the lowest rung, then the timed rungs. Open the second timed rung.
   const names=await page.locator('button.drill-cluster').evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')));
   const timed=names.map((n,i)=>[n,i]).filter(([n])=>n==='Play with the beat').map(([,i])=>i);
   await timedStep(page,timed[1]);
   const ready=await bands(page);for(const box of Object.values(ready))expect(box).not.toBeNull();
   // Before a take: Listen, never Start over; the tempo track and one click-volume button, no four-button row.
   expect(await headerButtons(page)).toEqual(['Listen']);
   expect(await page.getByRole('button',{name:'Start over'}).count()).toBe(0);
   expect(await page.getByRole('button',{name:/^Speed/}).count()).toBe(1);
   expect(await page.getByRole('button',{name:/^Click volume/}).count()).toBe(1);
   for(const banned of ['BPM','Soft','Medium','Loud','Max','Score tempo','Fallback tempo'])expect(await page.locator('.piano-learn-lab__toolbar').innerText()).not.toContain(banned);
   const header=await page.locator('.piano-learn-lab__toolbar').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));expect(header.scroll).toBeLessThanOrEqual(header.client);
   const targets=await page.locator('.piano-learn-lab__toolbar button:not([disabled])').evaluateAll(list=>list.filter(b=>getComputedStyle(b).visibility!=='hidden').map(b=>{const r=b.getBoundingClientRect();return Math.min(r.width,r.height);}));
   expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);
   await shot(page,'1-gold-step-ready');
   // During a take: Pause only, the track locked.
   await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
   await page.locator('.piano-learn-lab__run-controls[data-phase="countdown"], .piano-learn-lab__run-controls[data-phase="running"]').waitFor();
   expect(await headerButtons(page)).toEqual(['Pause']);
   // During a take the settings leave the header; their slot stays.
   expect(await page.locator('.piano-learn-speed, .piano-learn-click').count()).toBe(0);
   expect(await bands(page)).toEqual(ready);
   await shot(page,'2-gold-step-during-take');
   await click(page,'Pause');await page.locator('.piano-exercise-run[data-phase="paused"]').waitFor();
   await expect.poll(()=>headerButtons(page)).toEqual(['Resume','Start over']);
   expect(await bands(page)).toEqual(ready);
   await shot(page,'3-gold-step-paused');
   await click(page,'Start over');await armed(page);await expect.poll(()=>headerButtons(page)).toEqual(['Listen']);
   // A take with notes missing: the result takes the strip's slot and nothing moves.
   await playAt(page,await page.locator('.piano-learn-speed strong').evaluate(el=>parseInt(el.textContent,10)),{only:[0,1,2,3,4,5]});
   const result=page.locator('.piano-exercise-run__result.is-docked');await result.waitFor({timeout:20000});
   await page.locator('.piano-exercise-run__result[data-result-armed="true"]').waitFor({timeout:15000});
   expect(await bands(page)).toEqual(ready);
   const slot=await result.boundingBox();expect([Math.round(slot.y),Math.round(slot.height)]).toEqual([ready.strip[1],ready.strip[3]]);
   expect(await result.evaluate(el=>el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1)).toBe(true);
   expect(await page.locator('.piano-exercise-run__meters li').count()).toBe(3);
   expect(await result.locator('.piano-exercise-run__verdict').count()).toBe(1);
   // Pictures, not sentences: no percentages and no "Release the keys…" line.
   expect(await result.innerText()).not.toMatch(/%|Release the keys|Hold the lowest/);
   await shot(page,'4-missed-result');
   // A pedal is any key: it takes the card's way on, and the band boxes still hold.
   await page.evaluate(()=>window.__cc(64,127));await page.evaluate(()=>window.__cc(64,0));
   await expect.poll(async()=>(await logged(page,'piano.exercise-retry')).map(d=>d.via)).toEqual(['pedal']);
   await armed(page);expect(await bands(page)).toEqual(ready);
   // A pedal also starts the armed take, and is never a note.
   await page.evaluate(()=>window.__cc(66,127));
   await expect.poll(async()=>(await logged(page,'piano.exercise-countdown-started')).at(-1)?.reason).toBe('pedal');
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },180000);

 it('a pass at a chosen faster tempo lights, then credits, every rung up to it',async()=>{
  const{page,f,errors}=await open();try{
   await openGold(page,'Rhythm');
   const names=await page.locator('button.drill-cluster').evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')));
   const timed=names.map((n,i)=>[n,i]).filter(([n])=>n==='Play with the beat').map(([,i])=>i);
   await timedStep(page,timed[0]);
   const stops=await speedStops(page);
   const rungs=(await speedStops(page,'[data-rung]')).map(label=>parseInt(label,10));
   const chosen=rungs.filter(r=>r<100).at(-1);
   // Nothing below the step's own tempo on a note step.
   expect(parseInt(stops[0],10)).toBe(parseInt(await page.locator('.piano-learn-speed strong').innerText(),10));
   await chooseSpeed(page,`${chosen}%`);await armed(page);
   expect(await page.locator('.piano-learn-speed strong').innerText()).toBe(`${chosen}%`);
   expect(await page.locator('.drill-cluster[data-preview]').count()).toBeGreaterThan(1);
   await shot(page,'5-chosen-tempo-prelit');
   await playAt(page,chosen);
   await card(page,`Passed at ${chosen}%`).waitFor({timeout:20000});
   expect(await card(page,`Passed at ${chosen}%`).innerText()).toContain(`Everything up to ${chosen}% done`);
   await shot(page,'6-passed-at-chosen-tempo');
   const outcome=[...f.attempts.values()].at(-1);expect(outcome.context.learnCoachTask).toMatchObject({tempoPercent:chosen});
   await page.locator('.rep-card').waitFor({state:'detached',timeout:10000});
   // Every rung up to the chosen tempo is done; score tempo is not.
   const done=await page.locator('button.drill-cluster').evaluateAll(list=>list.map(b=>[b.getAttribute('aria-label'),b.hasAttribute('data-done')]));
   expect(done.filter(([,d])=>d).length).toBe(done.length-1);expect(done.at(-1)[1]).toBe(false);
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },180000);

 it('the rhythm step goes down as well as up, can be skipped, and its result shows taps and the beat',async()=>{
  const{page,errors}=await open();try{
   await openGold(page,'Rhythm');
   const ready=await bands(page);
   const step=parseInt(await page.locator('.piano-learn-speed strong').innerText(),10);
   const stops=(await speedStops(page)).map(label=>parseInt(label,10));
   expect(stops[0]).toBeLessThan(step);
   // Skip rhythm is not in the header before a take; a miss puts it on the result card.
   expect(await page.getByRole('button',{name:'Skip rhythm'}).count()).toBe(0);
   await shot(page,'7-rhythm-step-ready');
   // A rhythm take with taps missing: two meters (taps, on the beat), the strip's slot.
   await playAt(page,step,{only:[0,1,2,3,4]});
   const result=page.locator('.piano-exercise-run__result.is-docked');await result.waitFor({timeout:20000});
   expect(await page.locator('.piano-exercise-run__meters li').count()).toBe(2);
   expect(await bands(page)).toEqual(ready);
   await page.locator('.piano-exercise-run__result[data-result-armed="true"]').waitFor({timeout:15000});
   await shot(page,'8-rhythm-result');
   expect(await result.getByRole('button',{name:'Skip rhythm'}).count()).toBe(1);
   await result.getByRole('button',{name:'Skip rhythm'}).click();
   await page.locator('.piano-learn-lab__heading strong').filter({hasNotText:'Tap the rhythm'}).waitFor({timeout:15000});
   expect((await logged(page,'piano.learn.rhythm.skip')).length).toBe(1);
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },180000);

 it('Listen plays the passage inside the drill: Pause and Stop, a moving cursor, no take, no layout change',async()=>{
  const{page,f,errors}=await open();try{
   await openGold(page,'Rhythm');
   const names=await page.locator('button.drill-cluster').evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')));
   await timedStep(page,names.indexOf('Play with the beat'));
   const ready=await bands(page);const saved=f.attempts.size;
   await click(page,'Listen');
   await page.locator('.piano-exercise-run[data-listening="playing"]').waitFor();
   expect(await headerButtons(page)).toEqual(['Pause','Stop']);
   const cursorX=()=>page.locator('.piano-score-passage__cursor').first().evaluate(el=>el.getBoundingClientRect().x);
   const first=await cursorX();
   await page.waitForFunction((x)=>document.querySelector('.piano-score-passage__cursor')?.getBoundingClientRect().x>x+1,first,{timeout:8000});
   expect(Number(await page.getByRole('progressbar',{name:'Listening'}).getAttribute('aria-valuenow'))).toBeGreaterThan(0);
   expect(await bands(page)).toEqual(ready);
   await shot(page,'9-listening');
   // A key while listening starts nothing.
   await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
   await click(page,'Pause');await page.locator('.piano-exercise-run[data-listening="paused"]').waitFor();
   expect(await headerButtons(page)).toEqual(['Play','Stop']);
   // Paused, the cursor stays where it is.
   const held=await cursorX();await page.waitForTimeout(900);expect(await cursorX()).toBe(held);
   await shot(page,'10-listening-paused');
   await click(page,'Stop');await page.locator('.piano-exercise-run:not([data-listening])').waitFor();
   expect(await headerButtons(page)).toEqual(['Listen']);
   expect(await page.locator('.piano-exercise-run[data-phase="ready"]').count()).toBe(1);
   expect(await bands(page)).toEqual(ready);expect(f.attempts.size).toBe(saved);
   expect((await logged(page,'piano.exercise-countdown-started')).length).toBe(0);
   // Played to the end, it hands back a drill ready to play.
   await click(page,'Listen');await page.locator('.piano-exercise-run:not([data-listening])').waitFor({timeout:15000});
   expect(await headerButtons(page)).toEqual(['Listen']);
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },180000);

 it('the click volume is one button opening four big levels',async()=>{
  const{page,errors}=await open();try{
   await openGold(page,'Rhythm');
   await page.getByRole('button',{name:/^Click volume/}).click();
   const levels=page.getByRole('group',{name:'Click volume levels'});await levels.waitFor();
   expect(await levels.getByRole('button').count()).toBe(4);
   await shot(page,'11-volume-sheet');
   await levels.getByRole('button',{name:'Soft'}).click();
   await expect.poll(()=>page.getByRole('button',{name:'Click volume: Soft'}).count()).toBe(1);
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },120000);
});
