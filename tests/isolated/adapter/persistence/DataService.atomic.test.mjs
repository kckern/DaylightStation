import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
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
