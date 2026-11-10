import {expect} from '@playwright/test';
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
  HTMLMediaElement.prototype.play=function(){const src=this.src;window.__audioEvents.push({kind:'play',src,at:performance.now()});this.addEventListener('ended',()=>window.__audioEvents.push({kind:'ended',src,at:performance.now()}),{once:true});const promise=play.call(this);promise?.then(()=>window.__audioEvents.push({kind:'started',src,at:performance.now()}),()=>window.__audioEvents.push({kind:'failed',src,at:performance.now()}));return promise;};
  HTMLMediaElement.prototype.pause=function(){window.__audioEvents.push({kind:'pause',src:this.src,at:performance.now()});return pause.call(this);};
  window.__answerEvents=[];let previousAnswer='';new MutationObserver(()=>{const label=document.querySelector('.jp-clue__locked')?.textContent||'';if(label&&label!==previousAnswer)window.__answerEvents.push({label,at:performance.now()});previousAnswer=label;}).observe(document,{subtree:true,childList:true,characterData:true});
  window.__pendingEvents=[];new MutationObserver(()=>{if(document.body?.textContent.includes('buzz received — confirming'))window.__pendingEvents.push(performance.now());}).observe(document,{subtree:true,childList:true,characterData:true});
 },{model});
}
async function buttons(page,indices,down){return page.evaluate(async({indices,down})=>{const at=performance.now();for(const index of indices)window.__pads[index].buttons[0]={pressed:down,value:Number(down)};await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return at;},{indices,down});}
async function tap(page,index){const at=await buttons(page,[index],true);await buttons(page,[index],false);return at;}
async function create({page,context,request,history=0}){
 const created=await request.post('/api/v1/gaming/sessions',{data:{definition_id:'jeopardy:fhe-jeremiah',seats:teams}}).then(json);const id=created.header.session_id;
 if(history){
  let current=created;
  for(let n=0;n<history;n++)current=await request.post(endpoint(id)+'/commands',{data:{command_id:`cmd:history:${n}`,actor_id:'host',expected_revision:current.header.revision,logical_time:Date.now(),command:n?{type:'BUZZER_PRESENCE',epoch:'latency-seed'}:{type:'BUZZER_SETUP',epoch:'latency-seed'}}}).then(json);
 }
 expect(id.startsWith('game:')).toBe(true);expect(created.state.inputProtocolVersion).toBe(1);expect(created.state.set.rounds.every(r=>r.mode==='hosted')).toBe(true);
 await hardware(page);await page.setViewportSize({width:960,height:540});await page.goto(`/screens/living-room/party-games/jeopardy:fhe-jeremiah?session=${encodeURIComponent(id)}`);
 const host=await context.newPage();await host.setViewportSize({width:390,height:844});await host.goto(`/party-games/host/${encodeURIComponent(id)}`);
 await expect(page.getByText('Ready to play',{exact:true})).toBeVisible({timeout:30000});
 const waitTeam=async(team,property,value)=>expect.poll(async()=>(await get(request,id)).state.buzzerSetup?.teams[team]?.[property]).toBe(value);
 for(const [index,team]of [[1,'blue'],[2,'gold']]){const name=teams.find(t=>t.id===team).name;await expect(page.getByText(`${name} — press your buzzer`,{exact:true})).toBeVisible();await tap(page,index);await waitTeam(team,'connected',true);await expect(page.getByText(`${name} — press again to test`,{exact:true})).toBeVisible();await tap(page,index);await waitTeam(team,'tested',true);}
 await expect(host.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
 const click=async name=>{await host.getByRole('button',{name,exact:true}).click();};
 const phase=async value=>{await expect(host.locator('.gp-host')).toHaveAttribute('data-phase',value);if(value==='done')await expect(page.getByTestId('results')).toBeVisible();else await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase',value);};
 const select=async(cat,row)=>{await host.locator('.gp-host__col').nth(cat).locator('.gp-host__tile').nth(row).click();};
 const open=async(cat=0,row=1)=>{await select(cat,row);await expect(page.getByTestId('clue-screen')).toBeVisible();};
 return{id,host,page,request,click,phase,select,open,waitTeam,get:()=>get(request,id)};
}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}

export {teams,model,endpoint,json,get,command,hardware,buttons,tap,create,deferred};
