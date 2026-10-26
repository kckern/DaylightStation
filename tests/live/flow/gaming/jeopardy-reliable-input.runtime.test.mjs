import {test,expect} from '@playwright/test';
const teams=[{id:'blue',name:'Blue Team',color:'#3273dc',members:[]},{id:'gold',name:'Gold Team',color:'#e6b325',members:[]}];
const model='8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)';
const endpoint=id=>`/api/v1/gaming/sessions/${encodeURIComponent(id)}`;
async function json(response){const text=await response.text();expect(response.ok(),text).toBeTruthy();return JSON.parse(text);}
const get=(request,id)=>request.get(endpoint(id)).then(json);
async function command(request,id,command){const current=await get(request,id);return request.post(endpoint(id)+'/commands',{data:{command_id:`cmd:acceptance:${crypto.randomUUID()}`,actor_id:'host',expected_revision:current.header.revision,logical_time:Date.now(),command}}).then(json);}
async function hardware(page){
 await page.addInitScript(({model})=>{
  const pad=(index,id,buttons=17)=>({index,id,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:buttons},()=>({pressed:false,value:0}))});
  window.__pads=[pad(0,'USB Mouse',3),pad(1,model),pad(2,model)];Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__pads});
  window.__audioEvents=[];const play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play=function(){const src=this.src;window.__audioEvents.push({kind:'play',src,at:performance.now()});this.addEventListener('ended',()=>window.__audioEvents.push({kind:'ended',src,at:performance.now()}),{once:true});return play.call(this);};
  HTMLMediaElement.prototype.pause=function(){window.__audioEvents.push({kind:'pause',src:this.src,at:performance.now()});return pause.call(this);};
  window.__pendingEvents=[];new MutationObserver(()=>{if(document.body?.textContent.includes('buzz received — confirming'))window.__pendingEvents.push(performance.now());}).observe(document,{subtree:true,childList:true,characterData:true});
 },{model});
}
async function buttons(page,indices,down){return page.evaluate(async({indices,down})=>{const at=performance.now();for(const index of indices)window.__pads[index].buttons[0]={pressed:down,value:Number(down)};await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return at;},{indices,down});}
async function tap(page,index){const at=await buttons(page,[index],true);await buttons(page,[index],false);return at;}
async function create({page,context,request}){
 const created=await request.post('/api/v1/gaming/sessions',{data:{definition_id:'jeopardy:fhe-jeremiah',seats:teams}}).then(json);const id=created.header.session_id;
 expect(id.startsWith('game:')).toBe(true);expect(created.state.inputProtocolVersion).toBe(1);expect(created.state.set.rounds.every(r=>r.mode==='hosted')).toBe(true);
 await hardware(page);await page.setViewportSize({width:960,height:540});await page.goto(`/screens/living-room/party-games/jeopardy:fhe-jeremiah?session=${encodeURIComponent(id)}`);
 const host=await context.newPage();await host.setViewportSize({width:390,height:844});await host.goto(`/party-games/host/${encodeURIComponent(id)}`);
 await expect(page.getByText('Ready to play',{exact:true})).toBeVisible();
 const waitTeam=async(team,property,value)=>expect.poll(async()=>(await get(request,id)).state.buzzerSetup?.teams[team]?.[property]).toBe(value);
 for(const [index,team]of [[1,'blue'],[2,'gold']]){await tap(page,index);await waitTeam(team,'connected',true);await tap(page,index);await waitTeam(team,'tested',true);}
 await expect(host.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
 const click=async name=>{await host.getByRole('button',{name,exact:true}).click();};
 const phase=async value=>{await expect(host.locator('.gp-host')).toHaveAttribute('data-phase',value);if(value==='done')await expect(page.getByTestId('results')).toBeVisible();else await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase',value);};
 const select=async(cat,row)=>{await host.locator('.gp-host__col').nth(cat).locator('.gp-host__tile').nth(row).click();};
 const open=async(cat=0,row=1)=>{await select(cat,row);await expect(page.getByTestId('clue-screen')).toBeVisible();};
 return{id,host,page,request,click,phase,select,open,waitTeam,get:()=>get(request,id)};
}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
test.beforeAll(async({request})=>{
 const url=new URL(process.env.BASE_URL||'http://invalid');expect(['127.0.0.1','localhost']).toContain(url.hostname);
 expect(await request.get('/__jeopardy_acceptance').then(json)).toEqual({isolated:true,durable:true});
});
test('identical pads, ineligible Blue versus Gold, silent pending feedback, and no spam cues',async ({page,context,request})=>{
 const h=await create({page,context,request});await h.click('Start game');await h.phase('board');await h.open();
 const baselineBuzzes=await h.page.evaluate(()=>window.__audioEvents.filter(e=>e.kind==='play'&&e.src.endsWith('/buzz.mp3')).length);
 await tap(h.page,1);await h.phase('judging');await h.click('Wrong ✗');await h.phase('clue');
 const gate=deferred();let intercepted=false;
 await h.page.route('**/commands',async route=>{if(route.request().postDataJSON()?.command?.type==='jeopardy.buzz'&&!intercepted){intercepted=true;await gate.promise;}await route.continue();});
 const at=await buttons(h.page,[1,2],true);await buttons(h.page,[1,2],false);
 await expect(h.page.getByText('Gold Team buzz received — confirming…')).toBeVisible();
 const pending=await h.page.evaluate(at=>window.__pendingEvents.find(time=>time>=at)-at,at);expect(pending).toBeLessThanOrEqual(50);
 for(let n=0;n<50;n++)await tap(h.page,n%2?1:2);
 const cuesBefore=await h.page.evaluate(()=>window.__audioEvents.filter(e=>e.kind==='play'&&e.src.endsWith('/buzz.mp3')).length);
 expect(cuesBefore).toBe(baselineBuzzes+1);gate.resolve();await h.phase('judging');
 expect((await h.get()).state.answeringTeamId).toBe('gold');
 await expect.poll(()=>h.page.evaluate(()=>window.__audioEvents.filter(e=>e.kind==='play'&&e.src.endsWith('/buzz.mp3')).length)).toBe(baselineBuzzes+2);
 await h.click('Correct ✓');await h.phase('answer-review');expect((await h.get()).state.scores.gold).toBe(200);
 await expect(h.host.getByText('Scripture: Jeremiah 1:6')).toBeVisible();await expect(h.page.getByText(/Look up: Jeremiah 1:6/)).toBeVisible();
});
test('heartbeat during an outstanding candidate preserves the first winner and retries only the same context',async ({page,context,request})=>{
 const h=await create({page,context,request});await h.click('Start game');await h.open();const gate=deferred(),bodies=[];let waiting=false;
 await h.page.route('**/commands',async route=>{const body=route.request().postDataJSON();if(body.command?.type==='jeopardy.buzz'){bodies.push(body);if(!waiting){waiting=true;await gate.promise;}}await route.continue();});
 await tap(h.page,1);await expect(h.page.getByText('Blue Team buzz received — confirming…')).toBeVisible();
 const setup=(await h.get()).state.buzzerSetup;await command(h.request,h.id,{type:'BUZZER_PRESENCE',epoch:setup.epoch});await tap(h.page,2);
 expect(bodies).toHaveLength(1);gate.resolve();await h.phase('judging');expect((await h.get()).state.answeringTeamId).toBe('blue');
 expect(bodies.length).toBeGreaterThanOrEqual(2);expect(new Set(bodies.map(b=>b.command_id)).size).toBe(1);expect(new Set(bodies.map(b=>JSON.stringify(b.command.expectedContext))).size).toBe(1);
});
test('late old-clue request cannot block or erase a new Gold candidate or retarget its command',async ({page,context,request})=>{
 const h=await create({page,context,request});await h.click('Start game');await h.open();const old=deferred(),fresh=deferred(),bodies=[];
 await h.page.route('**/commands',async route=>{const body=route.request().postDataJSON();if(body.command?.type==='jeopardy.buzz'){bodies.push(body);await(bodies.length===1?old.promise:fresh.promise);}await route.continue();});
 await tap(h.page,1);await expect(h.page.getByText('Blue Team buzz received — confirming…')).toBeVisible();
 await h.click('Blue Team answers');await h.click('Correct ✓');await h.phase('answer-review');await h.click('Next question');await h.phase('board');await h.open(0,2);
 await tap(h.page,2);await expect(h.page.getByText('Gold Team buzz received — confirming…')).toBeVisible();expect(bodies).toHaveLength(2);
 old.resolve();await expect.poll(async()=>{const current=await h.get();return current.state.active.row;}).toBe(2);
 await expect(h.page.getByText('Gold Team buzz received — confirming…')).toBeVisible();fresh.resolve();await h.phase('judging');
 expect((await h.get()).state.answeringTeamId).toBe('gold');expect(bodies[0].command.expectedContext.row).toBe(1);expect(bodies[1].command.expectedContext.row).toBe(2);
 expect(bodies.filter(b=>b.command_id===bodies[0].command_id)).toHaveLength(1);await expect(h.page.getByText('Game connection interrupted')).toHaveCount(0);
});
test('lost buzz acknowledgement retries the identical durable envelope and scores once',async ({page,context,request})=>{
 const h=await create({page,context,request});await h.click('Start game');await h.open();const bodies=[];
 await h.page.route('**/commands',async route=>{const body=route.request().postDataJSON();if(body.command?.type==='jeopardy.buzz'){bodies.push(body);if(bodies.length===1){const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');return;}}await route.continue();});
 await tap(h.page,2);await h.phase('judging');await expect.poll(()=>bodies.length).toBe(2);expect(bodies[1]).toEqual(bodies[0]);
 await h.click('Correct ✓');await h.phase('answer-review');expect((await h.get()).state.scores.gold).toBe(200);
});
test('early held presses never buffer, and reconnect at a changed index requires explicit reassign and test',async({page,context,request})=>{
 const h=await create({page,context,request});const original=(await h.get()).state.buzzerSetup;
 await page.evaluate(()=>{window.__pads[2].connected=false;window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'),{gamepad:window.__pads[2]}));});
 await h.waitTeam('gold','connected',false);await expect(h.host.getByRole('button',{name:'Start game',exact:true})).toBeDisabled();
 await page.evaluate(()=>{window.__pads[3]={...window.__pads[2],index:3,connected:true,buttons:Array.from({length:17},()=>({pressed:false,value:0}))};window.dispatchEvent(Object.assign(new Event('gamepadconnected'),{gamepad:window.__pads[3]}));});
 await h.click('Reassign Gold Team');await tap(page,3);await h.waitTeam('gold','connected',true);await tap(page,3);await h.waitTeam('gold','tested',true);
 const restored=(await h.get()).state.buzzerSetup;expect(restored.epoch).toBe(original.epoch);expect(restored.teams.gold.generation).toBeGreaterThan(original.teams.gold.generation);expect(restored.teams.gold.slot).toBe(`gamepad:3:${model}`);
 await h.click('Start game');await h.select(0,1);await expect(page.locator('.jp-board__tile.is-selected')).toHaveCount(1);
 await buttons(page,[3],true);await expect(page.getByTestId('clue-screen')).toBeVisible();expect((await h.get()).state.answeringTeamId).toBeNull();
 await buttons(page,[3],false);await tap(page,3);await h.phase('judging');expect((await h.get()).state.answeringTeamId).toBe('gold');
});
for(const ending of ['finish','continue'])test(`durable family round: toddler ownership, wager risk, answer review and ${ending}`,async({page,context,request})=>{
 test.setTimeout(180000);const h=await create({page,context,request});const epoch=(await h.get()).state.buzzerSetup.epoch;
 const traffic=[];page.on('request',req=>{if(req.url().endsWith('/commands'))traffic.push(req.postDataJSON());});
 await h.click('Start game');await h.phase('board');const firstActive=traffic.length;
 const round=async index=>{
  const set=(await h.get()).state.set;for(let cat=0;cat<5;cat++)for(let row=0;row<3;row++){
   const clue=set.rounds[index].categories[cat].clues[row];await h.select(cat,row);
   if(clue.daily_double){
    await h.phase('wager');const before=await h.get(),team=before.state.answeringTeamId;
    await expect(page.getByText(clue.clue,{exact:true})).toHaveCount(0);await h.click('+100');await h.click('+100');await expect(h.host.getByText('Right: +300 · Wrong: −300')).toBeVisible();
    await h.click('Lock wager');await expect(page.getByTestId('clue-screen')).toBeVisible();await h.click('Wrong ✗');await h.phase('answer-review');
    expect((await h.get()).state.scores[team]).toBe(before.state.scores[team]-300);
   }else{
    await expect(page.getByTestId('clue-screen')).toBeVisible();
    if(clue.little_kids){const current=await h.get();await expect(h.host.getByText(`${teams.find(t=>t.id===current.state.answeringTeamId).name} answers`,{exact:true})).toBeVisible();await h.click('Correct ✓');}
    else await h.click('Show answer — end attempts');
    await h.phase('answer-review');
   }
   await expect(page.getByTestId('scripture-reference')).toContainText(clue.scripture_reference);await expect(page.getByText(clue.answer,{exact:true})).toBeVisible();await h.click('Next question');
  }
 };
 await round(0);await h.phase('round-decision');expect(traffic.slice(firstActive).filter(b=>b.command.type==='jeopardy.buzzer.presence')).toHaveLength(0);
 if(ending==='continue'){
  await h.click('Continue to Round 2');await h.phase('round-intro');await expect(h.host.getByRole('button',{name:'Start round',exact:true})).toBeEnabled();expect((await h.get()).state.buzzerSetup.epoch).toBe(epoch);
  await h.click('Start round');await h.phase('board');await round(1);await h.phase('final-category');await h.click('Continue');await h.phase('final-wager');
  await h.click('Lock wager');await h.click('Lock wager');await h.phase('final-clue');await expect(page.getByTestId('scripture-reference')).toContainText('Jeremiah 32:15');
  await h.click('Show answer — end attempts');await h.phase('final-judging');for(const team of teams)await h.host.locator('.gp-host__row').filter({hasText:team.name}).getByRole('button',{name:'Correct',exact:true}).click();
 }else await h.click('Finish game');
 await h.phase('done');await expect.poll(()=>page.evaluate(()=>window.__audioEvents.some(e=>e.kind==='ended'&&e.src.endsWith('/win.mp3'))),{timeout:30000}).toBe(true);
 const win=await page.evaluate(()=>window.__audioEvents.filter(e=>e.src.endsWith('/win.mp3')));expect(win.filter(e=>e.kind==='play')).toHaveLength(1);expect(win.filter(e=>e.kind==='pause')).toHaveLength(0);
 await page.screenshot({path:test.info().outputPath(`${ending}-results.png`),animations:'disabled'});await page.reload();await expect(page.getByTestId('results')).toBeVisible();expect(await page.evaluate(()=>window.__audioEvents.filter(e=>e.src.endsWith('/win.mp3')).length)).toBe(0);
});
