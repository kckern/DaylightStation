import {test as base,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createAgendaFixture} from './fixture.mjs';

// Playwright grants fixture teardown a separate lifetime even after a test timeout.
export const test=base.extend({agendaFixture:async({page,request},use,testInfo)=>{
 const events=[];
 page.on('console',message=>{
  const match=message.text().match(/\b(menu\.tap-select|menu\.navigation\.error|agenda-menu\.(?:request|error)|participant-launch\.(?:request|response|operation|result|error|cancel))\b/);
  if (match) events.push({event:match[1]});
 });
 page.on('pageerror',error=>events.push({event:'pageerror',name:error.name}));
 page.on('response',response=>{const path=new URL(response.url()).pathname;if (/\/participant-launches\/(inspect|begin|resume)$/.test(path)) events.push({event:'launch-http',operation:path.split('/').pop(),status:response.status()});});
 const fixture=await createAgendaFixture({page,request},testInfo);
 try {await use(fixture);} finally {
  testInfo.setTimeout(testInfo.timeout+30000);
  try {await writeFile(testInfo.outputPath('agenda-events-private.json'),JSON.stringify(events,null,2));} finally {await fixture.cleanup();}
 }
}});
export {expect};
