import { test, expect as baseExpect } from '@playwright/test';
const expect=baseExpect.configure({timeout:30_000});

const routePath='/screens/living-room/party-games/jeopardy:fhe-jeremiah?return_to=%2Fscreens%2Fliving-room%2Ffhe';

test('Jeremiah: anonymous teams complete both boards and Final using only the remote',async({page,request})=>{
 test.setTimeout(240_000);
 await page.setViewportSize({width:960,height:540});
 const errors=[]; const failures=[]; let sessionId;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/v1/gaming/')&&r.status()>=400)failures.push([r.status(),r.url()]);});
 // Exercise real setup and creation while isolating scores/effects from family history.
 await page.route('**/api/v1/gaming/sessions',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const response=await request.post('/api/v1/gaming/diagnostics/sessions',{data:route.request().postDataJSON()});
  expect(response.ok()).toBe(true);const body=await response.json();sessionId=body.header.session_id;
  await route.fulfill({response,json:body});
 });
 const state=async()=>{const r=await request.get(`/api/v1/gaming/sessions/${encodeURIComponent(sessionId)}`);expect(r.ok()).toBe(true);return (await r.json()).state;};
 const key=async name=>{
  const response=page.waitForResponse(r=>r.url().includes('/commands')&&r.request().method()==='POST');
  await page.keyboard.press(name);expect((await response).ok()).toBe(true);
 };
 try {
  await page.goto(routePath);
  await expect(page.getByTestId('team-setup')).toBeVisible({timeout:90_000});
  await expect(page.getByTestId('teams-confirm')).toBeFocused();
  await expect(page.getByText('Blue Team',{exact:true})).toBeVisible();
  await expect(page.getByText('Gold Team',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Guest|Kids vs Parents/})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('anonymous-teams.png')});
  // Reproduce the real failure: the page has lost focus before the first OK.
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Fill the board'})).toBeFocused();
  await expect(page.getByText('Buzzer check')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('button',{name:'Fill the board'})).toBeVisible();
  await page.evaluate(()=>document.activeElement?.blur());
  const expectedScores={team_1:0,team_2:0};let clueIndex=0;
  for(let round=0;round<2;round++){
   await key('Enter');
   await expect(page.getByTestId('jeopardy-board')).toBeVisible();
   await expect(page.getByTestId('control-legend')).toContainText('Choose a question');
   for(let row=0;row<3;row++)for(let cat=0;cat<5;cat++){
    let s=await state();expect(s.roundIndex).toBe(round);expect(s.phase).toBe('board');
    await expect(page.locator('.jp-board__tile.is-cursor')).toBeFocused();
    await expect(page.locator('.jp-board__tile.is-cursor')).toBeEnabled();
    const team=clueIndex%2===0?'team_1':'team_2';expect(s.turnTeamId).toBe(team);
    while(s.cursor.cat!==cat){await key(s.cursor.cat<cat?'ArrowRight':'ArrowLeft');s=await state();}
    while(s.cursor.row!==row){await key(s.cursor.row<row?'ArrowDown':'ArrowUp');s=await state();}
    await key('Enter');s=await state();
    if(s.phase==='wager'){await expect(page.getByRole('button',{name:'Lock wager'})).toBeFocused();await key('Enter');s=await state();}
    await expect(page.getByTestId('clue-screen')).toBeVisible();
    expect(s.answeringTeamId).toBe(team);
    if(round===0&&row===0){
     await expect(page.getByText('Little kids’ turn',{exact:true})).toBeVisible();
     const image=page.locator('img.gp-media--image');await expect(image).toBeVisible();
     await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
     await expect.poll(async()=>{
      const [picture,prompt]=await Promise.all([image.boundingBox(),page.locator('.gp-reveal__prompt').boundingBox()]);
      return prompt.y-(picture.y+picture.height);
     }).toBeGreaterThanOrEqual(-1);
     if(cat===0)await page.screenshot({path:test.info().outputPath('little-kids-clue.png')});
    }
    if(clueIndex===2 || clueIndex===3){
     if(clueIndex===2)await key('Escape');
     else {
      const timeout=await page.waitForResponse(r=>r.url().includes('/commands')&&r.request().postDataJSON()?.command?.type==='jeopardy.timeout',{timeout:35_000});
      expect(timeout.ok()).toBe(true);
      await expect(page.locator('.gp-reveal__answer')).toBeVisible();
     }
     await key('Enter');
    }else{
     const value=s.isDailyDouble?s.wager:s.active.clue.value*(round===0?1:2);
     await key('Enter');await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase','judging');
     await expect.poll(async()=>{
      const [answer,team]=await Promise.all([page.locator('.gp-reveal__answer').boundingBox(),page.locator('.jp-clue__locked').boundingBox()]);
      return team.y-(answer.y+answer.height);
     }).toBeGreaterThanOrEqual(0);
     const correct=clueIndex!==1;await key(correct?'ArrowUp':'ArrowDown');if(correct)expectedScores[team]+=value;
    }
    expect((await state()).scores).toEqual(expectedScores);clueIndex++;
   }
  }
  await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase','final-category');
  await key('Enter');
  for(let i=0;i<2;i++){await expect(page.getByRole('button',{name:'Lock wager'})).toBeFocused();await key('Enter');}
  await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase','final-clue');
  await key('Enter');
  await expect(page.getByRole('button',{name:'Correct',exact:true}).first()).toBeFocused();
  await key('Enter');expectedScores.team_1+=100;
  await expect(page.getByRole('button',{name:'Correct',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button',{name:'Wrong',exact:true})).toBeFocused();
  await key('Enter');expectedScores.team_2-=100;
  await expect(page.getByTestId('results')).toBeVisible();
  expect((await state()).scores).toEqual(expectedScores);
  for(const [name,id] of [['Blue Team','team_1'],['Gold Team','team_2']]){
   await expect(page.getByTestId('results').locator('li').filter({hasText:name})).toContainText(expectedScores[id].toLocaleString());
  }
  await page.screenshot({path:test.info().outputPath('final-result.png')});
  expect(failures).toEqual([]);expect(errors).toEqual([]);
  await expect(page.getByRole('button',{name:'Play another game'})).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button',{name:'Exit Party Games'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/screens\/living-room\/fhe$/);
 }finally{
  if(sessionId)await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(sessionId)}`);
 }
});

for(const phase of ['judging','clue']) {
test(`revealed paragraph clues fit above controls on a TV: ${phase}`,async({page,request})=>{
 const response=await request.post('/api/v1/gaming/diagnostics/sessions',{data:{definition_id:'jeopardy:fhe-jeremiah',seats:[{id:'team_1',name:'Blue Team',members:[]},{id:'team_2',name:'Gold Team',members:[]}]}});
 expect(response.ok()).toBe(true);const session=await response.json();const id=session.header.session_id;
 try{
  const candidates=session.state.set.rounds.flatMap((r,roundIndex)=>r.categories.flatMap((c,cat)=>c.clues.map((clue,row)=>({clue,roundIndex,cat,row}))));
  const longest=candidates.sort((a,b)=>b.clue.clue.length-a.clue.clue.length)[0];
  const patched=await request.patch(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}/state`,{data:{patch:{phase,roundIndex:longest.roundIndex,active:{cat:longest.cat,row:longest.row,clue:longest.clue},revealed:true,answeringTeamId:phase==='judging'?'team_1':null}}});
  expect(patched.ok()).toBe(true);
  await page.setViewportSize({width:960,height:540});
  await page.goto(`${routePath}&diagnostic_session=${encodeURIComponent(id)}`);
  await expect(page.locator('.gp-reveal__answer')).toBeVisible();
  await expect.poll(async()=>{
   const [answer,team]=await Promise.all([page.locator('.gp-reveal__answer').boundingBox(),page.locator(phase==='judging'?'.jp-clue__locked':'.gp-legend').boundingBox()]);
   return team.y-(answer.y+answer.height);
  }).toBeGreaterThanOrEqual(0);
 }finally{await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}`);}
});

}

const auditSeats=[{id:'team_1',name:'Blue Team',color:'#3273dc',members:[]},{id:'team_2',name:'Gold Team',color:'#e6b325',members:[]}];
async function auditSession(request,patch={}){
 const r=await request.post('/api/v1/gaming/diagnostics/sessions',{data:{definition_id:'jeopardy:fhe-jeremiah',seats:auditSeats}});
 expect(r.ok()).toBe(true);const session=await r.json();const id=session.header.session_id;
 const updated=await request.patch(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}/state`,{data:{patch}});expect(updated.ok()).toBe(true);
 return {id,session};
}
async function openAudit(page,id){test.setTimeout(120_000);await page.setViewportSize({width:960,height:540});await page.goto(`${routePath}&diagnostic_session=${encodeURIComponent(id)}`);await expect(page.locator('.jeopardy')).toBeVisible({timeout:90_000});}

test('opening audit: deliberate Add Team happens once, then OK starts with visible primary focus',async({page,request})=>{
 let id;
 await page.route('**/api/v1/gaming/sessions',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  const response=await request.post('/api/v1/gaming/diagnostics/sessions',{data:route.request().postDataJSON()});
  expect(response.ok()).toBe(true);const session=await response.json();id=session.header.session_id;await route.fulfill({response,json:session});
 });
 try{
  await page.goto(routePath);await expect(page.getByTestId('teams-confirm')).toBeFocused();
  await page.keyboard.press('ArrowUp');await expect(page.getByRole('button',{name:'+ Team'})).toBeFocused();
  await page.keyboard.down('Enter');await expect(page.getByTestId('teams-confirm')).toHaveText('Start with 3 teams');
  await expect(page.getByTestId('teams-confirm')).toBeFocused();
  await page.keyboard.down('Enter');await page.keyboard.up('Enter');
  await expect(page.getByTestId('team-setup')).toBeVisible();await expect(page.getByTestId('teams-confirm')).toHaveText('Start with 3 teams');
  await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Fill the board'})).toBeFocused();
 }finally{if(id)await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}`);}
});

test('wager audit: Left navigates, one failed request recovers with OK without replaying it',async({page,request})=>{
 const {id,session}=await auditSession(request);let attempts=0;
 try{
  const clue=session.state.set.rounds[0].categories[3].clues[2];
  const patch=await request.patch(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}/state`,{data:{patch:{phase:'wager',active:{cat:3,row:2,clue},isDailyDouble:true,answeringTeamId:'team_1'}}});expect(patch.ok()).toBe(true);
  await page.route('**/commands',async route=>{
   if(route.request().postDataJSON()?.command?.type==='jeopardy.set.wager'&&++attempts===1)return route.fulfill({status:503,json:{message:'Temporary connection failure'}});
   await route.continue();
  });
  await openAudit(page,id);await expect(page.getByRole('button',{name:'Lock wager'})).toBeFocused();
  await page.keyboard.press('ArrowLeft');await expect(page.getByRole('button',{name:'+100',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowLeft');await expect(page.getByRole('button',{name:'−100',exact:true})).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('button',{name:'Lock wager'})).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Retry connection'})).toBeFocused();
  await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Lock wager'})).toBeFocused();expect(attempts).toBe(1);
  await page.keyboard.press('Enter');await expect(page.getByTestId('clue-screen')).toBeVisible();expect(attempts).toBe(2);
  const current=await(await request.get(`/api/v1/gaming/sessions/${encodeURIComponent(id)}`)).json();expect(current.state.wager).toBe(200);
 }finally{await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}`);}
});

test('final judging audit: Left changes choice and Escape owns the leave confirmation',async({page,request})=>{
 const {id}=await auditSession(request,{phase:'final-judging',finalWagers:{team_1:100,team_2:100}});
 try{
  await openAudit(page,id);await expect(page.getByRole('button',{name:'Correct',exact:true}).first()).toBeFocused();
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('button',{name:'Wrong',exact:true}).first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');await expect(page.getByRole('button',{name:'Correct',exact:true}).first()).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Keep playing'})).toBeFocused();
  await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase','final-judging');
 }finally{await request.delete(`/api/v1/gaming/diagnostics/sessions/${encodeURIComponent(id)}`);}
});
