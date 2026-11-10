import {test,expect} from '@playwright/test';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
async function json(response){const text=await response.text();expect(response.ok(),text).toBeTruthy();return JSON.parse(text);}
test.beforeAll(async({request})=>{
 expect(['127.0.0.1','localhost']).toContain(new URL(process.env.BASE_URL||'http://invalid').hostname);
 expect(await request.get('/__jeopardy_acceptance').then(json)).toMatchObject({isolated:true,durable:true});
});
for(const kind of ['legacy305','counter1000'])test(`real file-backed HTTP remains warm after ${kind}`,async({request})=>{
 test.setTimeout(120000);const seeded=await request.post('/__jeopardy_acceptance/fixtures',{data:{kind}}).then(json),id=seeded.sessionId,path=`/api/v1/gaming/sessions/${encodeURIComponent(id)}`;
 const read=()=>request.get(path).then(json),metrics=()=>request.get(`/__jeopardy_acceptance/metrics/${encodeURIComponent(id)}`).then(json);
 const coldAt=performance.now();let current=await read();const coldMs=performance.now()-coldAt;
 expect(current.header.revision).toBe(kind==='legacy305'?305:1000);
 if(kind==='legacy305')expect(await request.get(`/__jeopardy_acceptance/verify/${encodeURIComponent(id)}`).then(json)).toMatchObject({matches:true,sha256:'599d556af42b606972cf6234357ac7ddb6b2fabbb33376820bf972acf6be92a5'});
 const before=await metrics(),reads=[],writes=[];
 for(let n=0;n<30;n++){const at=performance.now();current=await read();reads.push(performance.now()-at);}
 for(let n=0;n<30;n++){
  const at=performance.now();current=await request.post(path+'/commands',{data:{command_id:`cmd:latency:${randomUUID()}`,actor_id:'host',logical_time:Date.now(),expected_revision:current.header.revision,command:kind==='legacy305'?{type:'BUZZER_PRESENCE',epoch:'baseline'}:{type:'counter.add'}}}).then(json);writes.push(performance.now()-at);
 }
 const after=await metrics(),warm=after.metrics.slice(before.metrics.length);
 expect(after.counts.journalRead-before.counts.journalRead).toBe(0);expect(after.counts.snapshotGet-before.counts.snapshotGet).toBe(0);expect(after.counts.runtimeDispatch-before.counts.runtimeDispatch).toBe(30);
 expect(warm.every(m=>m.cacheResult==='hit'&&m.replayedCommands===0)).toBe(true);
 expect(percentile(reads,.95)).toBeLessThanOrEqual(50);expect(percentile(writes,.95)).toBeLessThanOrEqual(150);
 expect(percentile(reads.slice(-6),.95)).toBeLessThanOrEqual(50);expect(percentile(writes.slice(-6),.95)).toBeLessThanOrEqual(150);
 if(kind==='counter1000')expect(current.state.count).toBe(1030);
 const result={kind,serverNode:seeded.node,coldMs,readP95:percentile(reads,.95),writeP95:percentile(writes,.95),first20:{readP95:percentile(reads.slice(0,6),.95),writeP95:percentile(writes.slice(0,6),.95)},last20:{readP95:percentile(reads.slice(-6),.95),writeP95:percentile(writes.slice(-6),.95)},warmOperations:warm.length,warmReplayedCommands:warm.reduce((sum,m)=>sum+m.replayedCommands,0)};
 console.log(JSON.stringify(result));await test.info().attach(kind+'-latency.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('a loaded 305-command scripture chase keeps first/last buzzer delivery within 250ms',async({page,context,request})=>{
 test.setTimeout(180000);const {create,tap}=await import('../../../_lib/jeopardy-browser-helpers.mjs');
 const h=await create({page,context,request,history:305}),samples=[];await h.click('Start game');await h.phase('board');
 const set=(await h.get()).state.set,round=set.rounds[0];
 for(let cat=0;cat<5;cat++)for(let row=0;row<3;row++){
  const clue=round.categories[cat].clues[row];await h.select(cat,row);
  if(clue.daily_double){await h.phase('wager');await h.host.screenshot({path:test.info().outputPath('wager-host.png'),animations:'disabled'});await h.click('Lock wager');}
  await expect(page.getByTestId('clue-screen')).toBeVisible();
  if(!clue.daily_double&&!clue.little_kids){
   const index=samples.length%2?1:2,at=await tap(page,index);await h.phase('judging');
   await expect.poll(()=>page.evaluate(at=>window.__audioEvents.some(e=>e.kind==='started'&&e.src.endsWith('/buzz.mp3')&&e.at>=at),at)).toBe(true);
   const timing=await page.evaluate(at=>({ui:window.__answerEvents.find(e=>e.at>=at)?.at-at,audio:window.__audioEvents.find(e=>e.kind==='started'&&e.src.endsWith('/buzz.mp3')&&e.at>=at)?.at-at}),at);
   expect(timing.ui).toBeLessThanOrEqual(250);expect(timing.audio).toBeLessThanOrEqual(250);samples.push(timing);
  }
  await h.click('Correct ✓');await h.phase('answer-review');
  if(samples.length===1)await page.screenshot({path:test.info().outputPath('clue-review-tv.png'),animations:'disabled'});
  const overflow=await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
  await h.click('Next question');
 }
 await h.phase('round-decision');expect(samples.length).toBeGreaterThanOrEqual(8);
 const first=samples.slice(0,Math.ceil(samples.length*.2)),last=samples.slice(-Math.ceil(samples.length*.2));
 const result={history:305,samples:samples.length,uiP95:percentile(samples.map(s=>s.ui),.95),audioP95:percentile(samples.map(s=>s.audio),.95),first20:first,last20:last};
 console.log(JSON.stringify(result));await test.info().attach('buzzer-delivery.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 await h.click('Finish game');await h.phase('done');
});
