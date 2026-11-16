import {test as base,expect} from '@playwright/test';
import {createAgendaFixture} from './fixture.mjs';

// Playwright grants fixture teardown a separate lifetime even after a test timeout.
export const test=base.extend({agendaFixture:async({page,request},use,testInfo)=>{
 const fixture=await createAgendaFixture({page,request},testInfo);
 try {await use(fixture);} finally {
  testInfo.setTimeout(testInfo.timeout+30000);
  await fixture.cleanup();
 }
}});
export {expect};
