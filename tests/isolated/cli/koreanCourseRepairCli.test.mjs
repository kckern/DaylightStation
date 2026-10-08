// @vitest-environment node
import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {assembleKoreanCourse} from '../../../cli/lib/korean-course.mjs';
import {publishDocument} from '../../../backend/src/2_domains/school/documents/documentSource.mjs';
const fixture=new URL('../../_fixtures/school/korean-3-2/',import.meta.url);
const read=n=>yaml.load(fs.readFileSync(new URL(n,fixture),'utf8'));
it('previews without base mutation, refuses stale save and retains original published keys on apply',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'korean-repair-base-')),out=fs.mkdtempSync(path.join(os.tmpdir(),'korean-repair-stage-'));
 const save=(rel,obj)=>{const f=path.join(base,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,yaml.dump(obj));};
 const dir=new URL('full-course/lessons/',fixture);
 const built=assembleKoreanCourse({baseLexicon:read('lexicon.yml'),baseUnit:read('korean-3-2.lesson-01.yml'),lessons:fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(new URL(n,dir),'utf8')))});
 save('media/school/language/korean-3-2/lexicon.yml',built.lexicon);
 for(const deck of built.decks)save(`data/content/school/learning-catalog/flashcard-decks/${deck.id}.yml`,deck);
 const sources=[read('lesson-01-a.yml'),read('lesson-01-b.yml'),...built.documents];
 // Simulate old published all-A material, keeping all semantic content.
 const units=structuredClone(built.units);
 for(const [i,source] of sources.entries()){
  if(i>1)source.blocks.filter(b=>b.type==='question').forEach(q=>{q.choices=[q.answer,...q.choices.filter(c=>c!==q.answer)];});
  const p=publishDocument(source),ref=`print/${source.id}@${p.rev}`;
  units[Math.floor(i/2)].assessmentForms[i%2]=ref;if(i%2===0)units[Math.floor(i/2)].document=ref;
  save(`data/content/school/learning-catalog/documents/language/korean-3-2/${source.id.replace('korean-3-2-','')}.yml`,source);
  save(`data/household/school/artifacts/print/documents/${source.id}/${p.rev}/document.yml`,p.published);
  save(`data/household/school/artifacts/print/documents/${source.id}/${p.rev}/answers.yml`,p.bank);
 }
 for(const u of units)save(`data/content/school/language/korean-3-2/units/${u.unitId}.yml`,u);
 const run=(apply=false)=>spawnSync(process.execPath,['cli/korean-course-repair.cli.mjs','--base',base,'--out',out,...(apply?['--apply']:[])],{encoding:'utf8'});
 const before=fs.readFileSync(path.join(base,'data/content/school/language/korean-3-2/units/korean-3-2.lesson-02.yml'));
 expect(run().status).toBe(0);
 expect(fs.readFileSync(path.join(base,'data/content/school/language/korean-3-2/units/korean-3-2.lesson-02.yml'))).toEqual(before);
 const file=path.join(base,'data/content/school/language/korean-3-2/units/korean-3-2.lesson-02.yml');fs.appendFileSync(file,'\n# concurrent write\n');
 const stale=run(true);expect(stale.status).not.toBe(0);expect(stale.stderr).toMatch(/Stale/);
 fs.writeFileSync(file,before);
 const applied=run(true);expect(applied.stderr).toBe('');expect(applied.status).toBe(0);
 expect(yaml.load(fs.readFileSync(file,'utf8')).assessmentForms).not.toEqual(units[1].assessmentForms);
 const [id,rev]=units[1].assessmentForms[0].slice(6).split('@');
 expect(yaml.load(fs.readFileSync(path.join(base,`data/household/school/artifacts/print/documents/${id}/${rev}/answers.yml`),'utf8')).items.every(q=>q.choices[0]===q.answer)).toBe(true);
 expect(run().status).toBe(0);expect(run(true).status).toBe(0);
 fs.rmSync(base,{recursive:true});fs.rmSync(out,{recursive:true});
});
