/** Verify selected source-edit cards compose in memory; no candidate tree/build/runtime. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root,packet,emit} from './census.mjs';
assert.ok(process.env.PRE_TOOLCHAIN_ROOT,'Explicit parser toolchain required');
const require=createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT,'package.json'));
const {parse}=require('@babel/parser');
const hash=value=>createHash('sha256').update(value).digest('hex');
const names=['utility-boundary.json','utility-reference-review.json','feed-boundary.json','homebot-boundary.json','household-boundary.json','fileio-boundary.json','fileio-reference-review.json','http-boundary.json','logging-boundary.json','rendering-boundary.json'];
const reports=new Map(names.map(name=>[name,JSON.parse(fs.readFileSync(path.join(packet,name)))]));
const utility=reports.get(names[0]),references=reports.get(names[1]),feed=reports.get(names[2]),homebot=reports.get(names[3]),household=reports.get(names[4]);
const fileio=reports.get(names[5]);
const fileioReferences=reports.get(names[6]);
const http=reports.get(names[7]);
const logging=reports.get(names[8]);
const rendering=reports.get(names[9]);
const inputs=new Map(),originals=new Map(),planned=new Map(),sequence=[];
function source(file){if(!originals.has(file)){const text=fs.readFileSync(path.join(root,file),'utf8');originals.set(file,text);inputs.set(file,{path:file,sha256:hash(text)});}return originals.get(file);}
function syntax(file,text){
  if(/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(file))parse(text,{sourceType:'unambiguous',plugins:['jsx',...(/\.tsx?$/.test(file)?['typescript']:[]),'decorators-legacy'],allowReturnOutsideFunction:true});
}
function spanEdits(text,changes){
  let last=Infinity;
  for(const change of [...changes].sort((a,b)=>b.start-a.start)){
    assert.ok(change.end<=last,'Overlapping source edits');
    assert.equal(text.slice(change.start,change.end),change.before,'Source span no longer matches baseline');
    text=text.slice(0,change.start)+change.after+text.slice(change.end);last=change.start;
  }
  return text;
}
function anchorEdit(text,change){
  if(change.occurrences){
    assert.match(change.before,/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    const expression=new RegExp('\\b'+change.before+'\\b','g');
    assert.equal([...text.matchAll(expression)].length,change.occurrences.length,'Rename population no longer matches');
    return text.replace(expression,change.after);
  }
  assert.equal(text.split(change.before).length,2,'Missing or ambiguous source anchor');
  return text.replace(change.before,change.after);
}
const spanChanges=[...utility.edits.map((e,index)=>({...e,specification:names[0],index})),
  ...references.edits.map((e,index)=>({...e,specification:names[1],index})),
  ...fileio.edits.map((e,index)=>({...e,specification:names[5],index})),
  ...fileioReferences.edits.map((e,index)=>({...e,specification:names[6],index})),
  ...http.edits.map((e,index)=>({...e,specification:names[7],index})),
  ...logging.edits.map((e,index)=>({...e,specification:names[8],index})),
  ...rendering.edits.map((e,index)=>({...e,specification:names[9],index}))];
for(const file of [...new Set(spanChanges.map(e=>e.path))]){
  const changes=spanChanges.filter(e=>e.path===file);
  planned.set(file,spanEdits(source(file),changes));
  sequence.push(...changes.map(e=>({specification:e.specification,index:e.index,path:file,stage:'joint baseline-addressed utility/FileIO import/reference edits'})));
}
for(const name of names.slice(2,5))for(const [index,change] of reports.get(name).edits.entries()){
  const text=planned.get(change.path)||source(change.path);
  planned.set(change.path,anchorEdit(text,change));sequence.push({specification:name,index,path:change.path,stage:'ordered integration edits after utility/FileIO rewrites'});
}
const files=[...planned].sort(([a],[b])=>a.localeCompare(b)).map(([file,text])=>{
  syntax(file,text);
  const utilityProjection=utility.editedFiles.find(f=>f.path===file)?.destination||fileio.edits.find(e=>e.path===file)?.destination||http.editedFiles.find(f=>f.path===file)?.destination||logging.editedFiles.find(f=>f.path===file)?.destination||rendering.editedFiles.find(f=>f.path===file)?.destination;
  const integrationProjection=household.edits.find(e=>e.path===file)?.afterRelocation;
  return {path:file,destination:utilityProjection||integrationProjection||file,sourceSha256:hash(source(file)),plannedSha256:hash(text),
    specifications:[...new Set(sequence.filter(e=>e.path===file).map(e=>e.specification))],
    editGroups:sequence.filter(e=>e.path===file).length,syntax:/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(file)?'parsed in memory':file.endsWith('.scss')?'stylesheet comment text only':'documentation text only'};
});
const newFiles=[...feed.newFiles,...homebot.newFiles,...household.newFiles,
  ...utility.facades.map(f=>({...f,owner:'platform'})),fileio.facade,http.facade,...logging.facades,...rendering.newFiles];
assert.equal(newFiles.length,35);assert.equal(new Set(newFiles.map(f=>f.path)).size,35,'Duplicate planned source authority');
for(const file of newFiles){
  assert.equal(hash(file.sourceText),file.sha256,'Planned source hash mismatch '+file.path);
  assert.equal(fs.existsSync(path.join(root,file.path)),false,'Unexpected existing candidate '+file.path);syntax(file.path,file.sourceText);
}
assert.ok(feed.newFiles.some(f=>f.path===homebot.sharedFactory.path&&f.sha256===homebot.sharedFactory.sha256));
assert.equal(sequence.length,utility.edits.length+references.edits.length+feed.edits.length+homebot.edits.length+household.edits.length+fileio.edits.length+fileioReferences.edits.length+http.edits.length+logging.edits.length+rendering.edits.length);
const sample=spanChanges[0],sampleText=source(sample.path);
assert.throws(()=>spanEdits(sampleText,[{...sample,before:'deliberately-wrong-anchor'}]),/Source span no longer matches baseline/);
assert.throws(()=>spanEdits(sampleText,[sample,sample]),/Overlapping source edits/);
const anchorSample=feed.edits.find(e=>!e.occurrences),anchorText=source(anchorSample.path);
assert.throws(()=>anchorEdit(anchorText.replace(anchorSample.before,'__REMOVED_PREP_ANCHOR__'),anchorSample),/Missing or ambiguous source anchor/);
const rename=homebot.edits.find(e=>e.occurrences);assert.ok(rename);
assert.throws(()=>anchorEdit(source(rename.path),{...rename,occurrences:[...rename.occurrences,{}]}),/Rename population no longer matches/);
const verifierControls=[
  {id:'COMBINED-WRONG-SPAN',result:'expected failure observed; original real span succeeds'},
  {id:'COMBINED-OVERLAP',result:'expected failure observed for duplicate edit; nonoverlapping joint sequence succeeds'},
  {id:'COMBINED-MISSING-ANCHOR',result:'expected failure observed after removing a real Feed anchor; original sequence succeeds'},
  {id:'COMBINED-WRONG-RENAME-COUNT',result:'expected failure observed with wrong Homebot population; original count succeeds'},
];
emit('combined-boundary-review.json',{schema:'daylight.preimplementation.combined-boundary-review/v1',baseline:utility.baseline,
  status:'Selected utility/FileIO/HTTP/logging/rendering source/reference and Feed/Homebot/household edits compose and parse in memory; not a migrated candidate or runtime proof',
  order:['joint baseline-addressed utility + FileIO + HTTP + logging + rendering/assets + reference-specification spans','Feed exact anchors','Homebot anchors/word replacements','household anchors'],
  sequence,files,newFiles:newFiles.map(f=>({path:f.path,sha256:f.sha256,owner:f.owner,layer:f.layer})),
  sharedFactory:{path:homebot.sharedFactory.path,sha256:homebot.sharedFactory.sha256,identicalSpecifications:true},
  verifierControls,overlapFiles:files.filter(f=>f.specifications.length>1),
  limits:['Only ten named source-edit specifications; full foundation, all owner relocations, asset moves and gated barrel retirements, manifests/lock/build, activation, root aliases, enforcement and candidate driver still require separate combined review.',
    'Four verifier controls test edit-plan sensitivity, not product behavioral red/green contracts; do not add them to selected product/probe assertion totals or product contract mutation pairs.',
    'Destination paths are projections for touched files. Files are neither moved nor copied, dependencies are not installed, proposed source is not evaluated, and no controller is started.',
    'Two stale Home Automation imports remain independently approved fixture repairs, not silently folded into a baseline-green claim. FileIO mock/proxy/native identity gates remain separate.'],
  inputs:[...inputs.values()],inventoryInputs:names.map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({editGroups:sequence.length,files:files.length,sourceFiles:files.filter(f=>f.syntax==='parsed in memory').length,
  newFiles:newFiles.length,multiSpecificationFiles:files.filter(f=>f.specifications.length>1).length,verifierControls:verifierControls.length})+'\n');
