/** Narrow revision boundary: sources may only permute choices; units may only repin forms. */
import {isDeepStrictEqual} from 'node:util';
import {publishDocument} from '../../backend/src/2_domains/school/documents/documentSource.mjs';
import {validateUnit} from '../../backend/src/2_domains/school/curriculum/unitValidation.mjs';
import {koreanAnswerKeys,reorderKoreanChoices,validKoreanAnswerKey} from './korean-course.mjs';
const questions=source=>source.blocks.filter(b=>b.type==='question');
const stripChoices=source=>({...source,blocks:source.blocks.map(b=>b.type==='question'?{...b,choices:[...b.choices].sort()}:b)});
const stripPins=unit=>{const result=structuredClone(unit);delete result.document;delete result.assessmentForms;return result;};
export function assertKoreanRepairScope(before,after){
 if(before.sources.length!==32||after.sources.length!==32||before.units.length!==16||after.units.length!==16)throw Error('Full 16-unit, 32-form inventory required');
 for(let i=0;i<32;i++){
  if(i<2&&!isDeepStrictEqual(before.sources[i],after.sources[i]))throw Error('Lesson 1 source must remain unchanged');
  if(!isDeepStrictEqual(stripChoices(before.sources[i]),stripChoices(after.sources[i])))throw Error(`Only choice permutation permitted: ${before.sources[i].id}`);
 }
 for(let i=0;i<16;i++){
  if(i===0&&!isDeepStrictEqual(before.units[i],after.units[i]))throw Error('Lesson 1 unit must remain unchanged');
  if(!isDeepStrictEqual(stripPins(before.units[i]),stripPins(after.units[i])))throw Error(`Only unit document pins permitted: ${before.units[i].unitId}`);
 }
}
export function prepareKoreanRepair({units,sources}){
 const next={units:structuredClone(units),sources:structuredClone(sources)},qa=[];
 for(let i=0;i<16;i++){
  const unit=next.units[i];
  if(unit.sequence!==i+1||unit.unitId!==`korean-3-2.lesson-${String(i+1).padStart(2,'0')}`)throw Error('Unexpected course order/identity');
  const keys=koreanAnswerKeys(questions(next.sources[i*2]).length,i+1),formKeys=[];
  const refs=[];
  for(let v=0;v<2;v++){
   const source=next.sources[i*2+v];
   if(source.id!==`korean-3-2-lesson-${String(i+1).padStart(2,'0')}-${v?'b':'a'}`)throw Error('Unexpected form identity');
   if(i>0)questions(source).forEach((q,j)=>{q.choices=reorderKoreanChoices(q.choices,q.answer,keys[v][j]);});
   const published=publishDocument(source);if(published.errors)throw Error(published.errors.join('; '));
   const ids=published.bank.items.map(q=>q.id);
   if(!isDeepStrictEqual(ids,Object.keys(unit.practice.questionCards)))throw Error(`Question roster mismatch: ${source.id}`);
   if(Object.values(unit.practice.questionCards).some(link=>link.cardIds.some(id=>!unit.practice.requiredCardIds.includes(id))))throw Error(`Orphan card link: ${unit.unitId}`);
   const key=published.bank.items.map(q=>q.choices.indexOf(q.answer));
   if(!validKoreanAnswerKey(key))throw Error(`Key quality failed: ${source.id}`);
   formKeys.push(key);refs.push(`print/${source.id}@${published.rev}`);
   qa.push({id:source.id,rev:published.rev,key:key.map(k=>'ABCD'[k]).join(''),counts:[0,1,2,3].map(k=>key.filter(n=>n===k).length),questions:ids.length});
  }
  if(formKeys[0].filter((k,j)=>k!==formKeys[1][j]).length<Math.ceil(formKeys[0].length/2))throw Error(`Alternate keys insufficiently distinct: ${unit.unitId}`);
  if(i>0){unit.document=refs[0];unit.assessmentForms=refs;}
  else if(!isDeepStrictEqual(unit.assessmentForms,refs))throw Error('Lesson 1 pins differ from original published sources');
  const checked=validateUnit(unit);if(checked.errors?.length)throw Error(checked.errors.join('; '));
 }
 assertKoreanRepairScope({units,sources},next);
 return {...next,qa};
}
