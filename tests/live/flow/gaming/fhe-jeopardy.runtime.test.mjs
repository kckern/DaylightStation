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
 const focus=async name=>{
  const button=page.getByRole('button',{name,exact:true}).first();
  for(let i=0;i<16;i++){
   if(await button.evaluate(el=>el===document.activeElement))return;
   await page.keyboard.press('ArrowRight');
  }
  await expect(button).toBeFocused();
 };
 try {
  await page.goto(routePath);
  await expect(page.getByTestId('team-setup')).toBeVisible({timeout:60_000});
  await expect(page.getByTestId('teams-confirm')).toBeFocused();
  await expect(page.getByText('Blue Team',{exact:true})).toBeVisible();
  await expect(page.getByText('Gold Team',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Guest|Kids vs Parents/})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('anonymous-teams.png')});
  // Add then remove a third team with remote controls.
  await focus('+ Team');await page.keyboard.press('Enter');
  await expect(page.getByTestId('teams-confirm')).toHaveText('Start with 3 teams');
  await page.keyboard.press('ArrowLeft'); // third team's Remove team
  await expect(page.getByRole('button',{name:'Remove team'}).last()).toBeFocused();
  await page.keyboard.press('Enter');
  await focus('Start with 2 teams');await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Fill the board'})).toBeVisible();
  await expect(page.getByText('Buzzer check')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('button',{name:'Fill the board'})).toBeVisible();
  const expectedScores={team_1:0,team_2:0};let clueIndex=0;
  for(let round=0;round<2;round++){
   await key('Enter');
   await expect(page.getByTestId('jeopardy-board')).toBeVisible();
   await expect(page.getByTestId('control-legend')).toContainText('Choose a question');
   for(let row=0;row<3;row++)for(let cat=0;cat<5;cat++){
    let s=await state();expect(s.roundIndex).toBe(round);expect(s.phase).toBe('board');
    const team=clueIndex%2===0?'team_1':'team_2';expect(s.turnTeamId).toBe(team);
    while(s.cursor.cat!==cat){await key(s.cursor.cat<cat?'ArrowRight':'ArrowLeft');s=await state();}
    while(s.cursor.row!==row){await key(s.cursor.row<row?'ArrowDown':'ArrowUp');s=await state();}
    await key('Enter');s=await state();
    if(s.phase==='wager'){await focus('Lock wager');await key('Enter');s=await state();}
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
  for(let i=0;i<2;i++){await focus('Lock wager');await key('Enter');}
  await expect(page.locator('.jeopardy')).toHaveAttribute('data-phase','final-clue');
  await key('Enter');
  await focus('Correct');await key('Enter');expectedScores.team_1+=100;
  await focus('Wrong');await key('Enter');expectedScores.team_2-=100;
  await expect(page.getByTestId('results')).toBeVisible();
  expect((await state()).scores).toEqual(expectedScores);
  for(const [name,id] of [['Blue Team','team_1'],['Gold Team','team_2']]){
   await expect(page.getByTestId('results').locator('li').filter({hasText:name})).toContainText(expectedScores[id].toLocaleString());
  }
  await page.screenshot({path:test.info().outputPath('final-result.png')});
  expect(failures).toEqual([]);expect(errors).toEqual([]);
  await focus('Exit Party Games');await page.keyboard.press('Enter');
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
