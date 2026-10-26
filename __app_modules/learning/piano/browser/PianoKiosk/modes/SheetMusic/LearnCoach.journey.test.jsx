// Real ScorePlayer -> LearnCoach -> LearnLab -> ExerciseRun -> assessor -> outbox -> service.
// Only hardware, roster/config, logging, and HTTP are replaced. Notation is engraved by OSMD.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pianoCoachFixture } from '../../../../../../../tests/_lib/pianoCoachFixture.mjs';
import { PianoLearnCoachService } from '../../../../server/application/PianoLearnCoachService.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const ARTIFACTS = path.join(ROOT, '.superpowers/sdd/2026-10-26-piano-learn-adaptive-flow/browser');
const SCORE_ID = 'files:coach-journey.musicxml';
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${[1, 2].map((number) => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>240</per-minute></metronome></direction-type><sound tempo="240"/></direction>' : ''}${[1, 2].map((staff) => `${staff === 2 ? '<backup><duration>4</duration></backup>' : ''}${['C','D','E','F'].map((step) => `<note><pitch><step>${step}</step><octave>${staff === 1 ? 4 : 3}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`).join('')}`).join('')}</measure>`).join('')}</part></score-partwise>`;
const stubs = [
 [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data,at:Date.now()}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
 [/PianoKiosk\/PianoConfig\.jsx$/, `const config={ timezone:'America/Los_Angeles', keyboard:{startNote:21,endNote:108}, sheetmusic:{ defaultMode:'learn', learn:{} } }; export const usePianoKioskConfig=()=>({config}); export const usePianoKioskConfigOptional=()=>({config});`],
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
 const bundle = await esbuild.build({ stdin:{ contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import ScorePlayer from './ScorePlayer.jsx';window.__mount=()=>{window.__root?.unmount();window.__root=createRoot(document.getElementById('root'));window.__root.render(<MemoryRouter><ScorePlayer score={{id:${JSON.stringify(SCORE_ID)},title:'Coach journey',musicXml:window.__xml}}/></MemoryRouter>);};window.__mount();`, resolveDir: HERE, loader:'jsx' }, bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"MODE":"production","DEV":false,"PROD":true}'},logLevel:'silent', plugins:[{name:'io-only',setup(build){
  build.onResolve({filter:/\.(scss|css)$/},args=>{ const file=args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):require.resolve(args.path);sheets.add(file);return{path:file,namespace:'sheet'};});
  build.onLoad({filter:/.*/,namespace:'sheet'},()=>({contents:'',loader:'js'}));
  build.onLoad({filter:/\.(jsx|js|mjs)$/},args=>{for(const [pattern,contents] of stubs)if(pattern.test(args.path))return{contents,loader:'jsx'};
    if(args.path.endsWith('/ui/icons/Icon.jsx')){const dir=path.join(path.dirname(args.path),'svg');const assets=Object.fromEntries(fs.readdirSync(dir).filter(f=>f.endsWith('.svg')).map(f=>[`./svg/${f}`,fs.readFileSync(path.join(dir,f),'utf8')]));return{contents:fs.readFileSync(args.path,'utf8').replace(/import\.meta\.glob\([^\n]+\)/,JSON.stringify(assets)),loader:'jsx'};}return null;});
 }}] });js=bundle.outputFiles[0].text;
 const sass = await import('sass-embedded'); const out=[];
 for(const file of new Set([path.join(ROOT,'__capabilities/music-notation/browser/styles/tokens.scss'),path.join(ROOT,'__app_modules/learning/piano/browser/pianoTokens.scss'),path.join(ROOT,'__app_modules/learning/piano/browser/PianoApp.scss'),...sheets]))out.push(file.endsWith('.css')?fs.readFileSync(file,'utf8'):(await sass.compileAsync(file,{loadPaths:[path.join(ROOT,'frontend'),path.dirname(file)]})).css);
 css=out.join('\n').replace(/@font-face\s*\{[^}]*\}/g,'');
 const {chromium}=await import('playwright');browser=await chromium.launch();fs.mkdirSync(ARTIFACTS,{recursive:true});
},180000);
afterAll(async()=>{await browser?.close();});
async function open(viewport={width:1280,height:800}){
 const f=pianoCoachFixture(); const service=new PianoLearnCoachService(f);const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__request',async({url,body,method})=>{
  const [,user]=url.match(/users\/([^/]+)/)??[];
  if(f.offline && method==='POST')throw new Error('offline');
  if(url.includes('/preferences'))return{};
  if(url.includes('/attempts')){f.attempts.set(body.attempt_id,{...body,user_id:user});return{attempt_id:body.attempt_id};}
  const [,key]=url.match(/practice\/([^/?]+)/)??[];
  if(url.includes('/coach'))return method==='POST'?service.record(user,key,body):service.get(user,key);
  if(key)return f.datastore.getPractice(user,key);return{};
 });
 await page.route('http://learn.test/**',route=>route.fulfill({status:200,body:'<!doctype html>'}));await page.goto('http://learn.test');
 await page.setContent(`<style>${css}html,body{margin:0}#root{height:calc(100vh - 70px)}</style><div class="piano-app"><header style="height:70px"></header><div id="root"></div></div>`);
 await page.evaluate(value=>{window.__xml=value},xml);await page.addScriptTag({content:js});
 return{page,f,errors};
}
const click=async(page,name)=>{await page.getByRole('button',{name,exact:true}).click({timeout:30000});};
async function prepareFull(page){await click(page,'Start learning');await click(page,'Try the full passage');await page.getByRole('button',{name:'Start practice',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.piano-learn-coach .is-primary')?.disabled);}
async function playFull(page){
 await click(page,'Start practice');await page.waitForFunction(()=>window.__logs.some(l=>l.event==='piano.exercise-countdown-started'));
 await page.evaluate(async()=>{const log=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);const downbeat=log.at+log.data.countdownRemainingMs;for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,Math.max(0,downbeat+i*250-Date.now())));window.__hold([[60,48],[62,50],[64,52],[65,53]][i%4]);await new Promise(r=>setTimeout(r,75));window.__hold([]);}});
 await page.getByRole('heading',{name:'Nice work!'}).waitFor({timeout:15000});
}
describe('real Learn journey',()=>{
 it('grades two-hand timed notes, saves each take once, earns skills and resumes after remount',async()=>{
  const{page,f,errors}=await open();try{
   await prepareFull(page);await page.screenshot({path:path.join(ARTIFACTS,'tablet-preparation.png')});
   expect(await page.locator('.piano-exercise-run').count()).toBe(0);
   await playFull(page);await page.waitForFunction(()=>document.body.innerText.includes('Progress saved'));
   expect(f.attempts.size).toBe(1);const attempt=[...f.attempts.values()][0];expect(attempt.diagnostics).toMatchObject({matched_notes:16,wrong_notes:0,missed_notes:0});
   expect(attempt.criteria.placement).toBeGreaterThanOrEqual(.8);
   await page.screenshot({path:path.join(ARTIFACTS,'tablet-result.png')});
   await click(page,'Play again');await page.waitForFunction(()=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length===2);
   // The explicit repeat is the same task, and reuses the true MIDI input path.
   await page.evaluate(async()=>{const l=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,Math.max(0,l.at+l.data.countdownRemainingMs+i*250-Date.now())));window.__hold([[60,48],[62,50],[64,52],[65,53]][i%4]);await new Promise(r=>setTimeout(r,75));window.__hold([]);}});
   await page.getByText('Played at score tempo',{exact:true}).waitFor({timeout:15000});await page.waitForFunction(()=>document.body.innerText.includes('Progress saved'));expect(f.attempts.size).toBe(2);
   await page.evaluate(()=>window.__mount());await page.getByRole('button',{name:'Continue learning',exact:true}).waitFor();await click(page,'Continue learning');
   expect(await page.getByText('Played at score tempo',{exact:true}).count()).toBe(1);expect(await page.locator('.piano-exercise-run').count()).toBe(0);expect(errors).toEqual([]);
  }catch(error){fs.writeFileSync(path.join(ARTIFACTS,'failure.json'),JSON.stringify({errors,attempts:[...f.attempts.values()],text:await page.locator('body').innerText(),logs:await page.evaluate(()=>window.__logs)},null,2));await page.screenshot({path:path.join(ARTIFACTS,'failure.png'),fullPage:true});throw error;}finally{await page.close();}
 },90000);
 it('retries a saved musical success after offline failure without mixing profiles',async()=>{
  const{page,f,errors}=await open();try{
   await prepareFull(page); f.offline=true; await playFull(page);
   await page.getByText('Progress not saved',{exact:true}).waitFor();
   expect(f.attempts.size).toBe(0);expect(await page.getByRole('heading',{name:'Nice work!'}).count()).toBe(1);
   await page.evaluate(()=>window.__profile('learner5'));await page.getByRole('button',{name:'Start practice',exact:true}).waitFor();
   expect(await page.getByRole('heading',{name:'Find the right-hand notes'}).count()).toBe(1);expect(await page.locator('.piano-exercise-run').count()).toBe(0);
   f.offline=false;await page.evaluate(()=>window.__profile('learner4'));await page.getByRole('button',{name:'Start practice',exact:true}).waitFor();
   await page.waitForFunction(()=>document.body.innerText.includes('Progress saved'));expect(f.attempts.size).toBe(1);
   expect([...f.attempts.values()][0].user_id).toBe('learner4');expect([...f.records.keys()].some(key=>key.startsWith('learner5/')&&f.records.get(key)?.learnCoach?.evidence?.length)).toBe(false);expect(errors).toEqual([]);
  }finally{await page.close();}
 },60000);
 it('demonstrates only the chosen hands without creating an assessment and returns to preparation',async()=>{
  const{page,f,errors}=await open();try{await click(page,'Start learning');await click(page,'Listen');
   await page.getByRole('heading',{name:'Listen to this passage'}).waitFor();await page.getByRole('button',{name:'Start practice',exact:true}).waitFor({timeout:15000});
   const audio=await page.evaluate(()=>window.__audio);expect(audio.length).toBe(8);expect(audio.every(note=>note>=60)).toBe(true);expect(f.attempts.size).toBe(0);expect(errors).toEqual([]);
  }finally{await page.close();}
 },60000);
 it('keeps keyboard focus and preparation usable on a narrow screen with reduced motion',async()=>{
  const{page,errors}=await open({width:600,height:800});try{await page.emulateMedia({reducedMotion:'reduce'});await click(page,'Start learning');await page.getByRole('button',{name:'Start practice',exact:true}).waitFor();
   await page.screenshot({path:path.join(ARTIFACTS,'narrow-preparation.png'),fullPage:true});
   const metrics=await page.locator('.piano-learn-coach button').evaluateAll(buttons=>buttons.filter(b=>b.offsetParent).map(b=>({height:b.getBoundingClientRect().height,right:b.getBoundingClientRect().right})));expect(metrics.every(m=>m.height>=64&&m.right<=600)).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);await page.getByRole('button',{name:'Start practice',exact:true}).focus();expect(await page.getByRole('button',{name:'Start practice',exact:true}).evaluate(e=>e===document.activeElement)).toBe(true);expect(errors).toEqual([]);
  }finally{await page.close();}
 },60000);
});
