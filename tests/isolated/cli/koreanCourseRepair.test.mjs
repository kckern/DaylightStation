// @vitest-environment node
import {it,expect} from 'vitest';
import fs from 'node:fs';
import yaml from 'js-yaml';
import * as repair from '../../../cli/lib/korean-course-repair.mjs';
import {assembleKoreanCourse} from '../../../cli/lib/korean-course.mjs';
const fixture=new URL('../../_fixtures/school/korean-3-2/',import.meta.url);
const read=n=>yaml.load(fs.readFileSync(new URL(n,fixture),'utf8'));
function input(){
 const dir=new URL('full-course/lessons/',fixture);
 const built=assembleKoreanCourse({baseLexicon:read('lexicon.yml'),baseUnit:read('korean-3-2.lesson-01.yml'),lessons:fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(new URL(n,dir),'utf8')))});
 return {units:built.units,sources:[read('lesson-01-a.yml'),read('lesson-01-b.yml'),...built.documents]};
}
it('guards choices-only source revisions and document-pins-only unit revisions',()=>{
 expect(typeof repair.assertKoreanRepairScope).toBe('function');
 const original=input(),next=structuredClone(original);
 next.sources[2].blocks.find(b=>b.type==='question').choices.reverse();
 expect(()=>repair.assertKoreanRepairScope(original,next)).not.toThrow();
 next.sources[2].blocks.find(b=>b.type==='question').answer='changed';
 expect(()=>repair.assertKoreanRepairScope(original,next)).toThrow(/permutation/);
 const changed=structuredClone(original);changed.units[1].practice.requiredCardIds.reverse();
 expect(()=>repair.assertKoreanRepairScope(original,changed)).toThrow(/pins/);
 const pilot=structuredClone(original);pilot.sources[0].blocks.find(b=>b.type==='question').choices.reverse();
 expect(()=>repair.assertKoreanRepairScope(original,pilot)).toThrow(/Lesson 1/);
});
it('prepares deterministic idempotent validated 32-form immutable revisions',()=>{
 expect(typeof repair.prepareKoreanRepair).toBe('function');
 const original=input(),next=repair.prepareKoreanRepair(original);
 expect(next.qa).toHaveLength(32);
 expect(next.units[0]).toEqual(original.units[0]);
 expect(next.sources.slice(0,2)).toEqual(original.sources.slice(0,2));
 expect(repair.prepareKoreanRepair(original)).toEqual(next);
 expect(repair.prepareKoreanRepair(next)).toEqual(next);
});
