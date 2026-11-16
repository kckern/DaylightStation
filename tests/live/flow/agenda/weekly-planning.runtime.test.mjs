import {test,expect} from '@playwright/test';
import {createAgendaFixture} from './fixture.mjs';
import {withCleanup} from './cleanup.mjs';

test('creates and edits two independent weekly plans in Admin',async({page,request},testInfo)=>{
 const fixture=await createAgendaFixture({page,request},testInfo);
 await withCleanup(async()=>{
  await page.goto(`/admin/content/agendas/${fixture.id}`);
  await page.getByRole('button',{name:'Create this week'}).click();
  await expect(page.getByRole('heading',{name:'This week'})).toBeVisible();
  await page.getByLabel('Title',{exact:true}).fill('Current acceptance week');
  await page.getByLabel('Named guest name').fill(fixture.guestName);await page.getByRole('button',{name:'Add named guest'}).click();
  await expect(page.getByText(fixture.guestName,{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Add anonymous guest'}).click();await page.getByRole('button',{name:'Add anonymous guest'}).click();
  await expect(page.getByLabel('Guest 1 name')).toBeVisible();await expect(page.getByLabel('Guest 2 name')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('admin-current-guest-controls.png'),fullPage:true});
  await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByText('published',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Back to series'}).click();await page.getByRole('button',{name:'Create next week'}).click();
  await expect(page.getByRole('heading',{name:'Next week'})).toBeVisible();await page.getByLabel('Title',{exact:true}).fill('Next acceptance week');
  await page.getByRole('button',{name:'Save draft'}).click();await page.screenshot({path:testInfo.outputPath('admin-next-week.png'),fullPage:true});
  await page.getByRole('link',{name:'Back to series'}).click();
  const plansResponse=await request.get(`${fixture.base}/${fixture.id}/plans`,{headers:fixture.headers});expect(plansResponse.ok()).toBe(true);
  const plans=(await plansResponse.json()).plans.map(p=>p.document);expect(plans).toHaveLength(2);
  const current=plans.find(p=>p.title==='Current acceptance week'),next=plans.find(p=>p.title==='Next acceptance week');
  expect(current.state).toBe('published');expect(current.participants).toHaveLength(3);expect(new Set(current.participants.map(p=>p.id)).size).toBe(3);expect(next.participants).toHaveLength(0);expect(next.plan_id).not.toBe(current.plan_id);
 },fixture.cleanup);
});
