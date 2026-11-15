import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {YamlGratitudeStore} from './YamlGratitudeStore.mjs';

it('refuses blank, misidentified, malformed, and impossible completed evidence',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'strict-gratitude-'));
  const store=new YamlGratitudeStore({configService:{getHouseholdPath:p=>path.join(root,p)}});
  const dir=path.join(root,'school/records/gratitude/child');mkdirSync(dir,{recursive:true});
  try{
    for(const source of ['',yaml.dump({learnerId:'other',studyDay:'2026-11-16',events:[]}),yaml.dump({learnerId:'child',studyDay:'2026-11-16',events:[{type:'completed',at:'2026-11-16T18:00:00Z'}]}),yaml.dump({learnerId:'child',studyDay:'2026-11-16',events:[null]})]){
      writeFileSync(path.join(dir,'2026-11-16.yml'),source);
      expect((await store.read('child','2026-11-16')).status).toBe('corrupt');
      await expect(store.append('child','2026-11-16',{type:'opened',at:'2026-11-16T18:00:00Z'})).rejects.toThrow(/corrupt/);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('does not turn a failed learner-directory read into an empty history',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'strict-list-'));
  const parent=path.join(root,'school/records/gratitude');mkdirSync(parent,{recursive:true});writeFileSync(path.join(parent,'child'),'not a directory');
  const store=new YamlGratitudeStore({configService:{getHouseholdPath:p=>path.join(root,p)}});
  try{await expect(store.listDays('child')).rejects.toThrow();}finally{rmSync(root,{recursive:true,force:true});}
});
