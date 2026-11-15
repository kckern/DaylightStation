import { it,expect } from 'vitest';
import { mkdtempSync,existsSync,readFileSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createGratitudeServices } from '../../composition/createGratitudeServices.mjs';

it('publishes once through the owner factory and preserves the normal stored/print shape',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'gratitude-publication-'));
  const dataService={household:{resolvePath:key=>path.join(root,key),read:key=>existsSync(path.join(root,key))?yaml.load(readFileSync(path.join(root,key),'utf8')):null,write:(key,value)=>{const file=path.join(root,key);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,yaml.dump(value));}}};
  dataService.household.writeAtomic=(key,value)=>{dataService.household.write(key,value);return true;};
  try {
    const services=createGratitudeServices({dataService,logger:{}});
    const input={householdId:'home',learnerId:'child',studyDay:'2026-11-16',subject:'Toys',selectionId:'school-gratitude:child:2026-11-16',timestamp:'2026-11-16T18:00:00Z'};
    await Promise.all([services.publishSchoolGratitude(input),services.publishSchoolGratitude(input)]);
    const selections=await services.gratitudeStore.getSelections('home','gratitude');
    expect(selections).toHaveLength(1);expect(selections[0].item.text).toBe('Toys');
    expect(dataService.household.read('gratitude/selections.gratitude.yml')).toEqual([{id:input.selectionId,userId:'child',item:{id:input.selectionId,text:'Toys'},datetime:input.timestamp,printed:[]}]);
    await expect(services.publishSchoolGratitude({...input,subject:'Cars'})).rejects.toThrow(/conflict/i);
    await services.publishSchoolGratitude({...input,studyDay:'2026-11-23',selectionId:'school-gratitude:child:2026-11-23'});
    expect(await services.gratitudeStore.getSelections('home','gratitude')).toHaveLength(2);
    // DataService can return null on a failed read; existing evidence must not be overwritten.
    dataService.household.read=()=>null;
    await expect(services.publishSchoolGratitude({...input,studyDay:'2026-11-24',selectionId:'school-gratitude:child:2026-11-24'})).rejects.toThrow(/unreadable/i);
    expect(yaml.load(readFileSync(path.join(root,'gratitude/selections.gratitude.yml'),'utf8'))).toHaveLength(2);
  } finally {rmSync(root,{recursive:true,force:true});}
});
