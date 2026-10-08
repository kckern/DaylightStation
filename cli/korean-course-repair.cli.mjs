#!/usr/bin/env node
/** Preview-only by default. Append immutable revisions, then guarded choices/pins activation. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseArgs,isDeepStrictEqual} from 'node:util';
import yaml from 'js-yaml';
import {validateLexicon,expandLexiconDeck} from '../backend/src/2_domains/school/cardLadder/lexicon.mjs';
import {prepareKoreanRepair} from './lib/korean-course-repair.mjs';
import {publishDocument} from '../backend/src/2_domains/school/documents/documentSource.mjs';
import {YamlPrintDocumentRepository} from '../backend/src/1_adapters/school/documents/YamlPrintDocumentRepository.mjs';
import {PublishPrintDocument} from '../backend/src/3_applications/school/documents/PublishPrintDocument.mjs';
const {values}=parseArgs({options:{base:{type:'string'},out:{type:'string'},apply:{type:'boolean',default:false}}});
if(!values.base||!values.out)throw Error('Usage: node cli/korean-course-repair.cli.mjs --base <content-base> --out <stage> [--apply]');
const base=fs.realpathSync(values.base),out=path.resolve(values.out);
fs.mkdirSync(out,{recursive:true});
if(fs.realpathSync(out)===base||fs.realpathSync(out).startsWith(base+path.sep))throw Error('Staging must be outside the content base');
const content='data/content/school',sourcesDir=`${content}/learning-catalog/documents/language/korean-3-2`,unitsDir=`${content}/language/korean-3-2/units`;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const dump=value=>yaml.dump(value,{noRefs:true,lineWidth:-1});
const load=(root,rel)=>yaml.load(fs.readFileSync(path.join(root,rel),'utf8'));
const write=(root,rel,bytes)=>{const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
const repository=root=>new YamlPrintDocumentRepository({directory:path.join(root,'data/household/school/artifacts/print'),sourceDirectory:path.join(root,content,'learning-catalog/documents')});
const original={units:[],sources:[]},paths=[];
for(let n=1;n<=16;n++){
 const lesson=`lesson-${String(n).padStart(2,'0')}`,unitPath=`${unitsDir}/korean-3-2.${lesson}.yml`;
 original.units.push(load(base,unitPath));paths.push({kind:'unit',index:n-1,path:unitPath});
 for(const letter of ['a','b']){const rel=`${sourcesDir}/${lesson}-${letter}.yml`;original.sources.push(load(base,rel));paths.push({kind:'source',index:original.sources.length-1,path:rel});}
}
const lexiconValidation=validateLexicon(load(base,'media/school/language/korean-3-2/lexicon.yml'));
if(lexiconValidation.errors.length)throw Error(lexiconValidation.errors.join('; '));
for(const unit of original.units){
 const deckPath=`${content}/learning-catalog/flashcard-decks/${unit.practice.deckId}.yml`;
 const raw=load(base,deckPath),expanded=expandLexiconDeck(raw,lexiconValidation.lexicon);
 if(expanded.errors.length)throw Error(expanded.errors.join('; '));
 if(!isDeepStrictEqual(raw.words,unit.practice.requiredCardIds))throw Error(`Deck roster differs from unit: ${unit.unitId}`);
}
const liveRepo=repository(base);
for(let i=0;i<32;i++){
 const published=publishDocument(original.sources[i]);if(published.errors)throw Error(published.errors.join('; '));
 const ref=`print/${original.sources[i].id}@${published.rev}`;
 if(original.units[Math.floor(i/2)].assessmentForms[i%2]!==ref)throw Error('Current source does not match pinned published revision');
 for(const [actual,expected] of [[liveRepo.getPublished(original.sources[i].id,published.rev),published.published],[liveRepo.getDerivedBank(original.sources[i].id,published.rev),published.bank]]){
  if(!isDeepStrictEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected))))throw Error('Current published artifact does not match source');
 }
}
const next=prepareKoreanRepair(original);
const files=paths.map(row=>{const obj=(row.kind==='unit'?next.units:next.sources)[row.index],prior=(row.kind==='unit'?original.units:original.sources)[row.index];return {...row,before:hash(fs.readFileSync(path.join(base,row.path))),after:hash(dump(obj)),changed:!isDeepStrictEqual(prior,obj)};});
const manifest={schema:'korean-3-2-choice-repair/v1',base,files,revisions:next.qa.map((row,i)=>({...row,beforeRev:publishDocument(original.sources[i]).rev,beforeKey:publishDocument(original.sources[i]).bank.items.map(q=>'ABCD'[q.choices.indexOf(q.answer)]).join('')}))};
const manifestPath=path.join(out,'revision-manifest.json');
function assertFresh(){for(const row of files)if(hash(fs.readFileSync(path.join(base,row.path)))!==row.before)throw Error(`Stale content: ${row.path}`);}
if(values.apply){
 if(!fs.existsSync(manifestPath))throw Error('Run preview before --apply');
 const approved=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(!isDeepStrictEqual(approved,manifest))throw Error('Stale preview: rerun preview and review revised manifest');
 for(const row of files)if(hash(fs.readFileSync(path.join(out,row.path)))!==row.after)throw Error(`Stale staging: ${row.path}`);
 assertFresh();
 // Complete and validate ALL publications before any source or unit reference changes.
 const publisher=new PublishPrintDocument({repository:liveRepo});
 for(const source of next.sources)await publisher.execute({source});
 assertFresh();
 for(const row of files.filter(r=>r.changed&&r.kind==='source'))write(base,row.path,fs.readFileSync(path.join(out,row.path)));
 for(const row of files.filter(r=>r.changed&&r.kind==='unit'))write(base,row.path,fs.readFileSync(path.join(out,row.path)));
 process.stdout.write(`Activated ${files.filter(r=>r.changed&&r.kind==='source').length} immutable form revisions; retained all original artifacts and issued allocations.\n`);
}else{
 const publisher=new PublishPrintDocument({repository:repository(out)});
 for(const source of [...original.sources,...next.sources])await publisher.execute({source});
 for(const row of files)write(out,row.path,dump((row.kind==='unit'?next.units:next.sources)[row.index]));
 write(out,'revision-manifest.json',JSON.stringify(manifest,null,2)+'\n');
 write(out,'choice-quality.json',JSON.stringify({forms:32,passed:true,lesson1Keys:next.qa.slice(0,2).map(r=>r.key),rows:next.qa},null,2)+'\n');
 write(out,'manifest.json',JSON.stringify({units:next.units.map(u=>({unitId:u.unitId,deckId:u.practice.deckId,forms:u.assessmentForms}))},null,2)+'\n');
 process.stdout.write(`Validated preview: 32 forms; ${files.filter(r=>r.changed&&r.kind==='source').length} choice revisions, ${files.filter(r=>r.changed&&r.kind==='unit').length} unit pin updates. Review ${manifestPath}.\n`);
}
