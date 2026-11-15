import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeopleDirectory } from '../application/PeopleDirectory.mjs';
import { YamlNamedGuestStore } from './YamlNamedGuestStore.mjs';

it('keeps ordered members separate from revisioned visitors and resolves archived history', async () => {
 const dir=mkdtempSync(join(tmpdir(),'people-'));
 try {
  const members=['b','a'];
  const directory=new PeopleDirectory({householdDirectory:{userIds:()=>members,userProfile:id=>({display_name:id.toUpperCase()})},guestStore:new YamlNamedGuestStore({pathForHousehold:()=>join(dir,'identity','named-guests.yml')})});
  expect((await directory.list({householdId:'h'})).map(x=>x.person.id)).toEqual(members);
  const created=await directory.createGuest({householdId:'h',input:{id:'visitor',name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'}},expectedRevision:0});
  expect(created.revision).toBe(1);
  await expect(directory.updateGuest({householdId:'h',id:'visitor',input:{name:'Renamed'},expectedRevision:0})).rejects.toThrow(/revision/i);
  await directory.updateGuest({householdId:'h',id:'visitor',input:{name:'Renamed'},expectedRevision:1});
  await directory.archiveGuest({householdId:'h',id:'visitor',expectedRevision:2});
  expect((await directory.list({householdId:'h'})).map(x=>x.person.id)).toEqual(members);
  expect(await directory.resolve({householdId:'h',person:{kind:'guest',id:'visitor'}})).toMatchObject({display:{name:'Renamed'},active:false});
  expect(await directory.resolve({householdId:'h',person:{kind:'guest',id:'missing'}})).toBeNull();
  expect(members).toEqual(['b','a']);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
