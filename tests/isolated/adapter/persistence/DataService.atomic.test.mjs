import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DataService} from '#adapters/persistence/files/DataService.mjs';
it('atomically confirms a household write and preserves the old document on serialization failure',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'atomic-household-'));
  try{
    const data=new DataService({configService:{getHouseholdPath:p=>path.join(root,p)}});
    expect(data.household.writeAtomic('gratitude/selections.gratitude.yml',[{text:'Toys'}])).toBe(true);
    expect(data.household.writeAtomic('gratitude/selections.gratitude.yml',{invalid:1n})).toBe(false);
    expect(data.household.read('gratitude/selections.gratitude.yml')).toEqual([{text:'Toys'}]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('user readStrict distinguishes absent from corrupt, and writeAtomic keeps the old document on failure',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'atomic-user-'));
  try{
    const data=new DataService({configService:{getDataDir:()=>root,getHeadOfHousehold:()=>'kc'}});
    expect(data.user.readStrict('apps/triage/queue','kc')).toBeNull();
    expect(data.user.writeAtomic('apps/triage/queue',{cards:[]},'kc')).toBe(true);
    expect(data.user.readStrict('apps/triage/queue','kc')).toEqual({cards:[]});
    expect(data.user.writeAtomic('apps/triage/queue',{invalid:1n},'kc')).toBe(false);
    expect(data.user.readStrict('apps/triage/queue','kc')).toEqual({cards:[]});
    writeFileSync(path.join(root,'users','kc','apps','triage','queue.yml'),'a: [unclosed');
    expect(()=>data.user.readStrict('apps/triage/queue','kc')).toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});
