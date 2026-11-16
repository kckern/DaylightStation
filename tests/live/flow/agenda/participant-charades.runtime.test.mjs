import {test,expect} from '@playwright/test';
import {createAgendaFixture} from './fixture.mjs';

test('launches a participant-bound Charades session and returns to its dated menu',async({page,request},testInfo)=>{
 const definition=process.env.AGENDA_TEST_CHARADES_DEFINITION;
 if (!definition) throw Error('AGENDA_TEST_CHARADES_DEFINITION must identify an installed Charades definition');
 const fixture=await createAgendaFixture({page,request},testInfo);
 try {
  await page.goto(`/admin/content/agendas/${fixture.id}`);await page.getByRole('button',{name:'Create this week'}).click();
  await page.getByLabel('Named guest name').fill(fixture.guestName);await page.getByRole('button',{name:'Add named guest'}).click();await expect(page.getByText(fixture.guestName,{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Add anonymous guest'}).click();await page.getByRole('button',{name:'Add anonymous guest'}).click();
  await page.getByRole('button',{name:'Add section'}).click();await page.getByRole('button',{name:'Add item',exact:true}).click();
  await page.getByTestId('item-label-input').fill('Acceptance Charades');await page.getByPlaceholder('Search content or type source:id').fill(`app:party-games/${definition}`);
  await page.getByLabel('Action',{exact:true}).click();await page.getByRole('option',{name:'Open',exact:true}).click();await page.getByTestId('save-item-button').click();
  await expect(page.getByText('Participants',{exact:true})).toBeVisible();await page.getByLabel('Choose participants').check();
  await page.getByLabel(fixture.guestName,{exact:true}).check();await page.getByLabel('Guest 1',{exact:true}).check();await page.getByLabel('Guest 2',{exact:true}).check();
  await page.getByLabel(`${fixture.guestName} clue mode`).selectOption('reader');await page.getByLabel('Guest 1 clue mode').selectOption('image');await page.getByLabel('Guest 2 clue mode').selectOption('text');await page.getByLabel('Start automatically').uncheck();
  await page.screenshot({path:testInfo.outputPath('admin-charades-subset.png'),fullPage:true});await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByText('published',{exact:true})).toBeVisible();
  const plansResponse=await request.get(`${fixture.base}/${fixture.id}/plans`,{headers:fixture.headers});expect(plansResponse.ok()).toBe(true);const plan=(await plansResponse.json()).plans[0].document;
  const item=plan.list.sections.flatMap(s=>s.items).find(i=>i.title==='Acceptance Charades');expect(item).toBeTruthy();expect(plan.activity_settings[item.uid].participants.ids).toHaveLength(3);
  let admissions=0;page.on('request',req=>{if(req.method()==='POST' && /participant-launches\/begin$/.test(new URL(req.url()).pathname)) admissions++;});
  await page.goto(`/tv?list=${encodeURIComponent(`agenda:${fixture.id}/plans/${plan.plan_id}`)}`);await expect(page.getByText('Acceptance Charades',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('tv-dated-menu.png')});
  await page.getByText('Acceptance Charades',{exact:true}).click();await expect(page.getByText('Review activity')).toBeVisible();expect(admissions).toBe(0);
  await expect(page.getByText(fixture.guestName,{exact:true})).toBeVisible();await expect(page.getByText('Guest 1',{exact:true})).toBeVisible();await expect(page.getByText('Guest 2',{exact:true})).toBeVisible();
  const responsePromise=page.waitForResponse(response=>response.request().method()==='POST' && /participant-launches\/begin$/.test(new URL(response.url()).pathname));
  await page.getByRole('button',{name:'Start',exact:true}).focus();await page.keyboard.press('Enter');const response=await responsePromise;expect(response.ok()).toBe(true);const launch=await response.json();expect(launch.kind).toBe('ready');expect(admissions).toBe(1);fixture.manifest.sessionIds.push(launch.output.data.session_id);await fixture.saveManifest();
  expect(launch.participant_context.participants).toHaveLength(3);expect(new Set(launch.participant_context.participants.map(p=>p.participant_id)).size).toBe(3);
  await expect(page.locator('.family-selector')).toBeVisible();expect(await page.locator('.family-selector .segment-avatar, .family-selector .segment-initials').count()).toBe(3);
  await page.screenshot({path:testInfo.outputPath('charades-session.png')});
  const sessionResponse=await request.get(`/api/v1/gaming/sessions/${encodeURIComponent(launch.output.data.session_id)}`,{headers:fixture.headers});expect(sessionResponse.ok()).toBe(true);const session=await sessionResponse.json();
  expect(session.header.seats).toHaveLength(3);expect(new Set(session.header.seats.map(seat=>seat.id)).size).toBe(3);
  const modeByName=new Map([[fixture.guestName,'reader'],['Guest 1','image'],['Guest 2','text']]);const modeById=new Map(session.header.seats.map(seat=>[seat.id,modeByName.get(seat.name)]));
  expect(session.header.seats.map(seat=>seat.members[0].avatar)).toEqual(launch.participant_context.participants.map(person=>person.display.avatar));
  expect(session.state.turn_order.length).toBeGreaterThanOrEqual(3);for (let i=0;i<session.state.clue_presentations.length;i++) expect(session.state.clue_presentations[i]).toBe(modeById.get(session.state.turn_order[Math.floor(i / session.definition.clues_per_turn) % session.state.turn_order.length]));
  await page.reload();await expect(page.locator('.charades')).toBeVisible();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Leave game'}).click();await expect(page.getByText('Acceptance Charades',{exact:true})).toBeVisible();
  await page.getByText('Acceptance Charades',{exact:true}).click();await expect(page.getByRole('button',{name:/^(Resume|View)/}).first()).toBeVisible();
  const resumePromise=page.waitForResponse(r=>r.request().method()==='POST' && /participant-launches\/resume$/.test(new URL(r.url()).pathname));await page.getByRole('button',{name:/^(Resume|View)/}).first().click();const resumed=await resumePromise;expect(resumed.ok()).toBe(true);expect((await resumed.json()).output.data.session_id).toBe(launch.output.data.session_id);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Leave game'}).click();await expect(page.getByText('Acceptance Charades',{exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('tv-return-focus.png')});
 } finally {await fixture.cleanup();}
});
