#!/usr/bin/env node
/** Author, verify, install and enroll the Korean 3-2 hybrid course. Never prints. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, isDeepStrictEqual, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFile } from 'node:child_process';
import yaml from 'js-yaml';
import { createCanvas } from '@napi-rs/canvas';
import { assembleKoreanCourse } from './lib/korean-course.mjs';
import { renderKoreanCourseGuide } from './lib/korean-course-guide.mjs';
import { preserveExistingEnrollments } from './lib/preserve-existing-enrollments.mjs';
import { YamlCurriculumDatastore } from '../backend/src/1_adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlPrintDocumentRepository } from '../backend/src/1_adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { PublishPrintDocument } from '../backend/src/3_applications/school/documents/PublishPrintDocument.mjs';
import { YamlAllocationStore } from '../backend/src/1_adapters/school/documents/YamlAllocationStore.mjs';
import { RenderPrintDocument } from '../backend/src/3_applications/school/documents/RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '../backend/src/1_rendering/school/documents/PrintDocumentRendering.mjs';
import { YamlAssignmentStore } from '../backend/src/1_adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { YamlLanguageStudyDatastore } from '../backend/src/1_adapters/persistence/yaml/YamlLanguageStudyDatastore.mjs';
import { SentenceLadderService } from '../backend/src/3_applications/school/LanguageStudyService.mjs';
import { createSchoolProgramEnrollmentValidators } from '../backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs';
import { SetAssignments } from '../backend/src/3_applications/school/usecases/SetAssignments.mjs';
import { GrownUpGate } from '../backend/src/3_applications/school/GrownUpGate.mjs';
import { validateLexicon, expandLexiconDeck } from '../backend/src/2_domains/school/cardLadder/lexicon.mjs';
const { values, positionals } = parseArgs({allowPositionals:true,options:{base:{type:'string'},out:{type:'string'},'source-dir':{type:'string'},learner:{type:'string'},'assigned-by':{type:'string'},apply:{type:'boolean',default:false}}});
const command=positionals[0],base=values.base,out=values.out;
if(!base||!out||!['build','audio','proofs','verify','install','enroll'].includes(command))throw Error('Usage: node cli/korean-course.cli.mjs build|audio|proofs|verify|install|enroll --base <content-base> --out <staging> [--learner <id> --assigned-by <adult-id> --apply]');
const SCHOOL='media/school/language/korean-3-2',CONTENT='data/content/school',DECKS=`${CONTENT}/learning-catalog/flashcard-decks/language/korean-3-2`,UNITS=`${CONTENT}/language/korean-3-2/units`,DOCUMENTS=`${CONTENT}/learning-catalog/documents/language/korean-3-2`;
const logger={info(){},debug(){},warn(event,data){process.stderr.write(`${event}: ${data?.error??''}\n`);},error(event){process.stderr.write(`${event}\n`);}};
const read=(file)=>yaml.load(fs.readFileSync(file,'utf8'));
const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
const save=(relative,value)=>write(path.join(out,relative),yaml.dump(value,{noRefs:true,lineWidth:-1}));
const asset=(entry,name,root=out)=>path.join(root,SCHOOL,'words',entry.group,entry.id,name);
const repository=(root)=>new YamlPrintDocumentRepository({directory:path.join(root,'data/household/school/artifacts/print'),sourceDirectory:path.join(root,CONTENT,'learning-catalog/documents')});
const manifest=()=>JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8'));
const stagedLexicon=()=>read(path.join(out,SCHOOL,'lexicon.yml'));
function verifyMedia(lexicon){
 for(const entry of lexicon.entries)for(const name of ['image.jpg','term.mp3','gloss.mp3']){
  const file=asset(entry,name);if(!fs.existsSync(file)||fs.statSync(file).size<500)throw Error(`Missing/incomplete media: ${entry.id}/${name}`);
  if(name.endsWith('.mp3')){const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',file],{encoding:'utf8'});if(probe.status!==0||!(Number(probe.stdout)>0))throw Error(`Invalid audio ${entry.id}/${name}`);}
 }
}
if(command==='build'){
 const sourceDir=values['source-dir']??fileURLToPath(new URL('../tests/_fixtures/school/korean-3-2/full-course/lessons/',import.meta.url));
 const lessons=fs.readdirSync(sourceDir).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(sourceDir,name),'utf8')));
 const result=assembleKoreanCourse({baseLexicon:read(path.join(base,SCHOOL,'lexicon.yml')),baseUnit:read(path.join(base,UNITS,'korean-3-2.lesson-01.yml')),lessons});
 save(`${SCHOOL}/lexicon.yml`,result.lexicon);
 for(const deck of result.decks)save(`${DECKS}/${deck.id.split('/').at(-1)}.yml`,deck);
 for(const unit of result.units)save(`${UNITS}/${unit.unitId}.yml`,unit);
 const publisher=new PublishPrintDocument({repository:repository(out)});
 for(const source of result.documents){save(`${DOCUMENTS}/${source.id.replace('korean-3-2-','')}.yml`,source);await publisher.execute({source});}
 // Seed the two original immutable forms for all-course proofing.
 const originalPublisher=new PublishPrintDocument({repository:repository(out)});
 for(const letter of ['a','b']){const relative=`${DOCUMENTS}/lesson-01-${letter}.yml`;save(relative,read(path.join(base,relative)));await originalPublisher.execute({source:read(path.join(base,relative))});}
 for(const entry of result.lexicon.entries){
  for(const name of ['image.jpg','term.mp3','gloss.mp3']){const from=asset(entry,name,base);if(fs.existsSync(from)&&!fs.existsSync(asset(entry,name)))write(asset(entry,name),fs.readFileSync(from));}
  if(fs.existsSync(asset(entry,'image.jpg')))continue;
  const canvas=createCanvas(960,640),ctx=canvas.getContext('2d');ctx.fillStyle='#eef4f7';ctx.fillRect(0,0,960,640);ctx.fillStyle='#25384b';ctx.font='bold 48px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  const lines=[''];for(const word of entry.gloss.split(' ')){const i=lines.length-1,candidate=(lines[i]+' '+word).trim();if(ctx.measureText(candidate).width>820)lines.push(word);else lines[i]=candidate;}
  lines.forEach((line,i)=>ctx.fillText(line,480,300+(i-(lines.length-1)/2)*66));ctx.font='24px sans-serif';ctx.fillStyle='#597388';ctx.fillText(`Korean 3-2 · ${entry.group.replace('lesson-','Lesson ')}`,480,560);
  write(asset(entry,'image.jpg'),canvas.toBuffer('image/jpeg'));
 }
 const courseManifest={schema:'korean-3-2-authoring/v1',cards:result.lexicon.entries.length,questions:result.units.reduce((sum,u)=>sum+Object.keys(u.practice.questionCards).length,0),units:result.units.map(u=>({unitId:u.unitId,deckId:u.practice.deckId,forms:u.assessmentForms,cards:u.practice.requiredCardIds.length,questions:Object.keys(u.practice.questionCards).length})),inventory:result.inventory};
 write(path.join(out,'manifest.json'),JSON.stringify(courseManifest,null,2));
 write(path.join(out,CONTENT,'language/korean-3-2/teacher-guide.md'),renderKoreanCourseGuide(courseManifest));
 process.stdout.write(`Built ${result.units.length} units, ${result.lexicon.entries.length} unique cards, 32 quiz forms.\n`);
}else if(command==='audio'){
 const lexicon=stagedLexicon(),cache=new Map(),jobs=[];
 for(const entry of lexicon.entries)for(const [name,text] of [['term',entry.term],['gloss',entry.gloss]]){
  const key=crypto.createHash('sha256').update(`${name}\0${text}`).digest('hex'),file=asset(entry,name+'.mp3');
  if(fs.existsSync(file)&&fs.statSync(file).size>1000)cache.set(key,Promise.resolve(fs.readFileSync(file)));
  else jobs.push({key,file,text});
 }
 const run=promisify(execFile);const work=path.join(out,'audio-work');fs.mkdirSync(work,{recursive:true});
 let cursor=0,complete=0;
 await Promise.all(Array.from({length:1},async()=>{
  while(cursor<jobs.length){const job=jobs[cursor++];if(!cache.has(job.key))cache.set(job.key,(async()=>{
   const aiff=path.join(work,job.key+'.aiff'),mp3=path.join(work,job.key+'.mp3');
   const english=job.file.endsWith('gloss.mp3');
   await run('say',['-v',english?'Samantha':'Yuna','-r',english?'160':'145','-o',aiff,job.text],{timeout:30000});
   await run('ffmpeg',['-v','error','-y','-i',aiff,'-ac','1','-ar','22050','-codec:a','libmp3lame','-q:a','3',mp3],{timeout:30000});
   const bytes=fs.readFileSync(mp3);if(bytes.length<1000)throw Error('Local voice produced empty audio.');return bytes;
  })());
   write(job.file,await cache.get(job.key));complete++;if(complete%25===0)process.stdout.write(`Local audio ${complete}/${jobs.length}\n`);
  }
 }));
 write(path.join(out,'audio-provenance.json'),JSON.stringify({engine:'macOS local speech',targetVoice:'Yuna',anchorVoice:'Samantha',preservedPilotAudio:true,externalTextTransfer:false},null,2));
 verifyMedia(lexicon);process.stdout.write(`Audio complete: ${lexicon.entries.length*2} valid MP3s.\n`);
}else if(command==='proofs'){
 const repo=repository(out),allocationStore=new YamlAllocationStore({directory:path.join(out,'proof-allocations')});
 const render=new RenderPrintDocument({repository:repo,allocationStore,rendering:createPrintDocumentRendering()});const proofs=[];
 for(const row of manifest().units){
  const unit=read(path.join(out,UNITS,`${row.unitId}.yml`));
  for(const [index,ref] of row.forms.entries()){
   const [id,rev]=ref.slice(6).split('@'),document=await repo.getPublished(id,rev);
   const result=await render.execute({document,context:{learnerId:`proof-${row.unitId}-${index}`,sessionId:`proof-${row.unitId}-${index}`,freshCard:true,assessmentItemIds:Object.keys(unit.practice.questionCards)}});
   write(path.join(out,'proofs',`${id}.pdf`),result.bytes);proofs.push({id,pages:result.pageCount,rows:result.allocation.rowRange.end-result.allocation.rowRange.start+1});
  }
  const [id,rev]=row.forms[1].slice(6).split('@'),selected=Object.keys(unit.practice.questionCards).slice(0,2);
  const retry=await render.execute({document:await repo.getPublished(id,rev),context:{learnerId:`retry-${row.unitId}`,sessionId:`retry-${row.unitId}`,freshCard:true,assessmentItemIds:selected}});
  const record=(await allocationStore.findByCard(retry.allocation.cardId)).find(r=>r.recordId===retry.allocation.recordId);
  if(JSON.stringify(record.rowItems.map(r=>r.itemId))!==JSON.stringify(selected))throw Error(`Retry row mismatch: ${row.unitId}`);
  write(path.join(out,'proofs',`${row.unitId}-retry.pdf`),retry.bytes);
 }
 write(path.join(out,'proofs','report.json'),JSON.stringify(proofs,null,2));process.stdout.write(`Rendered ${proofs.length} full forms and 16 shortened retries.\n`);
}else if(command==='verify'){
 verifyMedia(stagedLexicon());process.stdout.write(`Verified ${manifest().units.length} units and ${stagedLexicon().entries.length*3} media assets.\n`);
}else if(command==='install'){
 const lexicon=stagedLexicon(),old=read(path.join(base,SCHOOL,'lexicon.yml'));verifyMedia(lexicon);
 for(const entry of old.entries){if(!isDeepStrictEqual(entry,lexicon.entries.find(candidate=>candidate.id===entry.id)))throw Error(`Existing card would change: ${entry.id}`);}
 const copy=(relative)=>{const from=path.join(out,relative),to=path.join(base,relative);if(fs.existsSync(to)&&!fs.readFileSync(to).equals(fs.readFileSync(from)))throw Error(`Existing content differs: ${relative}`);write(to,fs.readFileSync(from));};
 const publisher=new PublishPrintDocument({repository:repository(base)});
 for(const row of manifest().units.filter(row=>!row.unitId.endsWith('lesson-01'))){
  for(const letter of ['a','b']){const relative=`${DOCUMENTS}/${row.unitId.replace('korean-3-2.','')}-${letter}.yml`;copy(relative);await publisher.execute({source:read(path.join(out,relative))});}
  copy(`${DECKS}/${row.deckId.split('/').at(-1)}.yml`);copy(`${UNITS}/${row.unitId}.yml`);
 }
 for(const entry of lexicon.entries)for(const name of ['image.jpg','term.mp3','gloss.mp3'])copy(path.relative(out,asset(entry,name)));
 // Single permitted replacement: package lexicon append, checked above against every existing entry.
 write(path.join(base,SCHOOL,'lexicon.yml'),fs.readFileSync(path.join(out,SCHOOL,'lexicon.yml')));
 const guide=`${CONTENT}/language/korean-3-2/teacher-guide.md`;if(fs.existsSync(path.join(out,guide)))write(path.join(base,guide),fs.readFileSync(path.join(out,guide)));
 process.stdout.write('Installed full course; existing Lesson 1 cards/forms/units unchanged.\n');
}else if(command==='enroll'){
 const learner=values.learner,adult=values['assigned-by'];if(!learner||!adult)throw Error('enroll requires --learner and --assigned-by');
 const data=path.join(base,'data'),configService={getHouseholdPath:p=>path.join(data,'household',p),getDataDir:()=>data,getMediaDir:()=>path.join(base,'media'),getUserDir:id=>path.join(data,'users',id)};
 const assignments=new YamlAssignmentStore({configService,logger}),old=await assignments.get(learner);if(!old)throw Error('Learner has no existing assignment plan.');
 const lexicon=validateLexicon(read(path.join(base,SCHOOL,'lexicon.yml'))).lexicon;
 const decks=new Map(manifest().units.map(row=>{const raw=read(path.join(base,DECKS,`${row.deckId.split('/').at(-1)}.yml`));return [row.deckId,expandLexiconDeck(raw,lexicon).deck];}));
 const units=manifest().units.map(row=>read(path.join(base,UNITS,`${row.unitId}.yml`)));
 const programs=[...old.programs];for(const row of manifest().units){const existing=programs.find(p=>p.programId==='flashcards'&&(p.deckId??p.corpusId)===row.deckId);if(existing){if(existing.linkedUnitId!==row.unitId)throw Error('Existing deck has a conflicting course link.');continue;}programs.push({programId:'flashcards',deckId:row.deckId,linkedUnitId:row.unitId,title:units.find(u=>u.unitId===row.unitId).title,subject:'language',policy:{mode:'card-ladder'},schedule:{daysOfWeek:[1,2,3,4,5]}});}
 const courses=[...old.courses];if(!courses.some(c=>(typeof c==='string'?c:c.courseId)==='korean-3-2'))courses.push({courseId:'korean-3-2',schedule:{daysOfWeek:[1,2,3,4,5]}});
 if(isDeepStrictEqual(programs,old.programs)&&isDeepStrictEqual(courses,old.courses)){process.stdout.write('All sixteen lessons are already enrolled; no write.\n');process.exit(0);}
 const validators=createSchoolProgramEnrollmentValidators({languageStudyService:new SentenceLadderService({datastore:new YamlLanguageStudyDatastore({configService}),logger}),pianoCourseLauncher:{},flashcardStudyService:{getDeck:async id=>{if(!decks.has(id))throw Error('Unknown deck');return decks.get(id);}}});
 // Unchanged durable enrollments do not depend on this importer's narrow
 // service catalog. Changed/new records still use the normal validators.
 const programValidators=preserveExistingEnrollments(validators,old.programs);
 const catalog=await new YamlCurriculumDatastore({configService}).listUnits();
 const knownUnitIds=new Set(units.map(unit=>unit.unitId));
 const catalogUnits=[...units,...catalog.items.map(item=>item.raw).filter(unit=>!knownUnitIds.has(unit.unitId))];
 const profile=read(path.join(data,'users',adult,'profile.yml'));
 const store={get:id=>assignments.get(id),put:async record=>{
  for(const existing of old.programs)if(!record.programs.some(next=>isDeepStrictEqual(next,existing)))throw Error('Existing program would change.');
  if(!isDeepStrictEqual(record.units,old.units)||!isDeepStrictEqual(record.courses.slice(0,old.courses.length),old.courses))throw Error('Existing course/unit assignments would change.');
  if(!isDeepStrictEqual(await assignments.get(learner),old))throw Error('Assignments changed since validation.');
  if(values.apply)return assignments.put(record);write(path.join(out,`${learner}-enrollment-proposed.yml`),yaml.dump(record,{noRefs:true,lineWidth:-1}));return record;
 }};
 const useCase=new SetAssignments({assignments:store,grownUps:new GrownUpGate({roster:[{id:adult,birthyear:profile.birthyear}],logger}),curriculum:{listUnits:async()=>[...catalogUnits,...old.courses.map(c=>({courseId:typeof c==='string'?c:c.courseId}))]},programValidators,logger});
 await useCase.execute({learnerId:learner,assignedBy:adult,baseUpdatedAt:old.updatedAt,courses,units:old.units,programs});
 process.stdout.write(`${values.apply?'Activated':'Validated preview for'} all sixteen linked lessons; existing enrollments preserved.\n`);
}
