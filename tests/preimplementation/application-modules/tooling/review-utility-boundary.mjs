/** Source-only utility export/import specification; never evaluates or edits product code. */
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
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const graph=read('dependency-ledger.json'),foundation=read('boundary-review.json'),owners=read('owner-boundaries.json');
const catalog=read('contracts.json'),inputs=new Map(),texts=new Map(),asts=new Map();
function source(file){
  if(!texts.has(file)){const text=fs.readFileSync(path.join(root,file),'utf8');texts.set(file,text);inputs.set(file,{path:file,sha256:hash(text)});}
  return texts.get(file);
}
function ast(file){if(!asts.has(file))asts.set(file,parse(source(file),{sourceType:'unambiguous',plugins:['jsx','importAttributes'],allowReturnOutsideFunction:true}));return asts.get(file);}
function walk(node,visit){if(!node||typeof node!=='object')return;if(node.type)visit(node);for(const [key,value] of Object.entries(node)){
  if(['loc','comments','tokens','leadingComments','trailingComments','innerComments','extra'].includes(key))continue;
  if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit);
}}
const system='backend/src/0_system/utils/',core='backend/src/2_domains/core/';
const mixed=system+'index.mjs',errorBarrel=system+'errors/index.mjs',domainBarrel=core+'errors/index.mjs';
const clock=system+'time.mjs',pure=core+'utils/time.mjs',timezone=core+'utils/timezone.mjs';
const strings=system+'strings.mjs',retired=new Set([mixed,errorBarrel]);
const selected=foundation.files.filter(f=>(f.path.startsWith(system)||f.path.startsWith(core))&&!f.path.endsWith('/FileIO.mjs'));
assert.equal(selected.length,17);
const byFile=new Map(selected.map(f=>[f.path,f])),foundationByFile=new Map(foundation.files.map(f=>[f.path,f]));
const moves=new Map(selected.filter(f=>!retired.has(f.path)&&f.path!==strings).map(f=>[f.path,f.proposedPath]));
assert.equal(moves.size,14);
const outgoing=new Map();for(const edge of graph.edges)outgoing.set(edge.from,[...(outgoing.get(edge.from)||[]),edge]);
function origin(file,name,seen=new Set()){
  const key=file+':'+name;assert.ok(!seen.has(key),'Export cycle '+key);const next=new Set(seen).add(key);
  const declared=foundationByFile.get(file)?.exports.find(e=>e.name===name);assert.ok(declared,'Unknown utility symbol '+key);
  // Named local re-exports can be imported bindings (parseToDate), not declarations.
  const local=(outgoing.get(file)||[]).find(e=>e.syntax==='ImportDeclaration'&&e.symbols.some(s=>s.local===name));
  if(local){const binding=local.symbols.find(s=>s.local===name);return origin(local.target,binding.imported,next);}
  if(declared.origin.file!==file||declared.origin.name!==name)return origin(declared.origin.file,declared.origin.name,next);
  return {file,name};
}
const external=graph.edges.filter(e=>byFile.has(e.target)&&!byFile.has(e.from));
const unknown=external.filter(e=>e.syntax!=='ImportDeclaration'&&e.syntax!=='dynamic-literal');assert.deepEqual(unknown,[]);
const dynamic=external.filter(e=>e.syntax==='dynamic-literal');assert.equal(dynamic.length,2);
assert.ok(external.filter(e=>e.syntax==='ImportDeclaration').every(e=>e.symbols.length&&e.symbols.every(s=>s.imported!=='*'&&s.imported!=='default')));
assert.ok(external.filter(e=>e.target===mixed).every(e=>e.symbols.every(s=>['nowTs','nowTs24','nowDate','nowMonth'].includes(s.imported))));
const specs=[
  {subpath:'server/system/utils/time',file:clock,names:['formatLocalTimestamp','getCurrentDate','nowDate','nowMonth','nowTs','nowTs24']},
  {subpath:'server/system/utils/id',file:system+'id.mjs',names:['entropyBytes','hexId','shortId','shortIdFromUuid','shortIdLower','uuid']},
  ...['ConfigurationError','EventBusError','FileIOError','SchedulerError'].map(name=>({
    subpath:'server/system/utils/errors/'+({FileIOError:'file-io-error'}[name]||name.replace(/([a-z])([A-Z])/g,'$1-$2').toLowerCase()),
    file:system+'errors/'+name+'.mjs',names:[name]})),
  {subpath:'server/system/utils/errors/infrastructure-error',file:system+'errors/InfrastructureError.mjs',
    names:['ExternalServiceError','InfrastructureError','PersistenceError','RateLimitError','TimeoutError']},
  {subpath:'server/system/utils/errors/vendor-error',file:system+'errors/vendorError.mjs',names:['isTransientStatus','translateVendorError']},
  {subpath:'server/domain/core/errors',file:domainBarrel,names:['DomainInvariantError','EntityNotFoundError','ValidationError']},
  {subpath:'server/domain/core/utils/time',file:pure,names:['formatIsoLocal','formatLocalTimestamp','getDateInTimezone','parseToDate']},
  {subpath:'server/domain/core/utils/timezone',file:timezone,names:['DEFAULT_TIMEZONE']},
];
const publicByOrigin=new Map(),facades=specs.map(spec=>{
  const file=foundationByFile.get(spec.file),privateSubpath=spec.subpath.slice('server/'.length);
  for(const name of spec.names){const o=origin(spec.file,name);const key=o.file+':'+o.name;assert.ok(!publicByOrigin.has(key));publicByOrigin.set(key,spec);}
  const sourceText=`export { ${spec.names.join(', ')} } from '@daylight-internal/platform--server/${privateSubpath}';\n`;
  parse(sourceText,{sourceType:'module'});
  return {entry:'@daylight/platform/'+spec.subpath,path:'platform/public/'+spec.subpath+'.mjs',sourceText,sha256:hash(sourceText),
    target:moves.get(spec.file),privateEntry:'@daylight-internal/platform--server/'+privateSubpath,
    names:spec.names,owner:'platform',category:'platform',runtime:'server',layer:file.layer,context:file.context,rank:file.rank,
    status:'selected source/export fragment; full package and enforcement adoption still gated'};
});
assert.equal(facades.length,11);
const publicUse=new Map();
function publicTarget(file,name){
  const o=origin(file,name),key=o.file+':'+o.name,spec=publicByOrigin.get(key);assert.ok(spec,'Unpublished external symbol '+key);
  publicUse.set(key,(publicUse.get(key)||0)+1);return {origin:o,entry:'@daylight/platform/'+spec.subpath,name:o.name};
}
function destination(file){return moves.get(file)||foundationByFile.get(file)?.proposedPath||owners.moves.find(m=>m.old===file)?.new||file;}
const edits=[],edgeDispositions=[],baselineDefects=[];
for(const edge of graph.edges.filter(e=>byFile.has(e.target))){
  if(retired.has(edge.from)){
    edgeDispositions.push({edgeId:edge.id,from:edge.from,target:edge.target,action:'removed with obsolete private barrel after complete reference gate'});continue;
  }
  const tree=ast(edge.from);let declaration=null,literal=null;
  if(edge.syntax==='dynamic-literal'){
    walk(tree,node=>{if(node.type==='VariableDeclarator'&&node.id.type==='ObjectPattern'){
      const init=node.init?.type==='AwaitExpression'?node.init.argument:null;
      const arg=init?.type==='ImportExpression'?init.source:init?.type==='CallExpression'&&init.callee.type==='Import'?init.arguments[0]:null;
      if(arg?.value===edge.specifier&&arg.loc.start.line===edge.line){
        assert.deepEqual(node.id.properties.map(p=>[p.key.name,p.value.name]),[['EntityNotFoundError','EntityNotFoundError']]);literal=arg;declaration=init;
      }
    }});
    assert.ok(literal,'Unreviewed dynamic utility use '+edge.id);assert.equal(edge.target,domainBarrel);
    publicTarget(domainBarrel,'EntityNotFoundError');
    const after=JSON.stringify('@daylight/platform/server/domain/core/errors');
    edits.push({edgeId:edge.id,path:edge.from,destination:destination(edge.from),start:literal.start,end:literal.end,
      line:literal.loc.start.line,before:source(edge.from).slice(literal.start,literal.end),after,
      reason:'same lazy import timing and destructuring; public facade retains canonical constructor'});
    edgeDispositions.push({edgeId:edge.id,from:edge.from,target:edge.target,action:'rewrite lazy literal',entry:'@daylight/platform/server/domain/core/errors'});continue;
  }
  assert.ok(['ImportDeclaration','ExportNamedDeclaration'].includes(edge.syntax),'Unreviewed utility syntax '+edge.id);
  declaration=tree.program.body.find(n=>n.type===edge.syntax&&n.loc.start.line===edge.line&&n.source?.value===edge.specifier);
  assert.ok(declaration,'Missing import declaration '+edge.id);literal=declaration.source;
  const missing=edge.symbols.filter(s=>!byFile.get(edge.target).exports.some(e=>e.name===s.imported));
  if(missing.length){
    const expectedTests=['ActivateDashboardScene','ToggleDashboardEntity'];
    const name=expectedTests.find(name=>edge.from===`tests/unit/applications/home-automation/${name}.test.mjs`);
    assert.ok(name,'New missing export needs investigation '+edge.id);
    assert.equal(edge.target,errorBarrel);assert.deepEqual(missing.map(s=>s.imported),['AuthorizationError']);
    assert.equal(edge.symbols.length,1);
    const usecase=`backend/src/3_applications/home-automation/usecases/${name}.mjs`;
    const semantic='backend/src/3_applications/common/errors/SemanticErrors.mjs';
    const specifier='#apps/common/errors/SemanticErrors.mjs';
    assert.ok(source(usecase).includes(`import { AuthorizationError } from '${specifier}'`));
    assert.ok(source(semantic).includes('export class AuthorizationError'));
    const before=source(edge.from).slice(literal.start,literal.end),after=JSON.stringify(specifier);
    baselineDefects.push({id:'UTILITY-BASELINE-'+name,edgeId:edge.id,path:edge.from,line:edge.line,
      missingExport:'AuthorizationError',actualTarget:semantic,usecase,
      proposedRepair:{before,after},status:'source-confirmed stale test import; original test not executed here; separate protected-test repair approval required'});
    edits.push({edgeId:edge.id,path:edge.from,destination:edge.from,line:edge.line,start:literal.start,end:literal.end,before,after,
      reason:'prerequisite stale-test import repair, not utility relocation or new platform export'});
    edgeDispositions.push({edgeId:edge.id,from:edge.from,target:edge.target,action:'separately approve prerequisite test import repair',newTarget:semantic});
    continue;
  }
  const localServer=destination(edge.from).startsWith('platform/server/'),groups=new Map(),bindings=[];
  for(const binding of edge.symbols){
    assert.ok(binding.imported&&binding.imported!=='*'&&binding.imported!=='default');
    const o=origin(edge.target,binding.imported);
    let entry,newName=o.name;
    if(localServer){
      assert.ok(moves.has(o.file),'Internal utility destination unavailable '+o.file);
      entry=path.posix.relative(path.posix.dirname(destination(edge.from)),moves.get(o.file));if(!entry.startsWith('.'))entry='./'+entry;
    }else{const p=publicTarget(edge.target,binding.imported);entry=p.entry;newName=p.name;}
    groups.set(entry,[...(groups.get(entry)||[]),{...binding,newName}]);bindings.push({oldName:binding.imported,local:binding.local,origin:o,entry,newName});
  }
  let start=literal.start,end=literal.end,after;
  if(groups.size===1&&bindings.every(b=>b.oldName===b.newName))after=JSON.stringify([...groups.keys()][0]);
  else{
    start=declaration.start;end=declaration.end;
    assert.equal(declaration.type,'ImportDeclaration','Unreviewed split re-export');
    assert.ok(!(tree.comments||[]).some(c=>c.start>start&&c.end<end),'Preserve inline comment explicitly before splitting '+edge.id);
    after=[...groups].map(([entry,bs])=>`import { ${bs.map(b=>b.newName===b.local?b.newName:b.newName+' as '+b.local).join(', ')} } from ${JSON.stringify(entry)};`).join('\n');
  }
  const before=source(edge.from).slice(start,end);
  // A source-only specifier may be byte-identical, but relocation resolution is still reviewed.
  edits.push({edgeId:edge.id,path:edge.from,destination:destination(edge.from),line:literal.loc.start.line,start,end,before,after,
    bindings,reason:localServer?'relative within one private server facet; preserve actual origin/layer':'named public entry; preserve local names and canonical implementation'});
  edgeDispositions.push({edgeId:edge.id,from:edge.from,target:edge.target,action:localServer?'private relative binding':'public named binding',bindings});
}
assert.equal(edgeDispositions.length,graph.edges.filter(e=>byFile.has(e.target)).length);
assert.equal(baselineDefects.length,2);
// Runtime consumers are not the only existing contract: the active adapter guide
// explicitly advertises parseToDate. Publish that binding from its pure SSOT,
// not the clock wrapper. This is a documented utility, not an aspirational port.
const guide='docs/reference/core/adapter-layer-guidelines.md';
const guideText=source(guide),guideAnchor='| **`0_system/utils/time`** | Timestamp formatting | `formatLocalTimestamp`, `parseToDate` |';
assert.ok(guideText.includes(guideAnchor));
const documentedConsumers=[{file:guide,line:guideText.slice(0,guideText.indexOf(guideAnchor)).split('\n').length,
  anchor:guideAnchor,origin:{file:pure,name:'parseToDate'},entry:'@daylight/platform/server/domain/core/utils/time',
  reason:'Preserve the active documented helper API, exposing its existing pure binding rather than importing a clocked module.'}];
for(const [key] of publicByOrigin)assert.ok(publicUse.get(key)||documentedConsumers.some(c=>c.origin.file+':'+c.origin.name===key),'No runtime or documented public consumer '+key);
const editedFiles=[];
for(const file of [...new Set(edits.map(e=>e.path))].sort()){
  let text=source(file),previousStart=Infinity;const changes=edits.filter(e=>e.path===file).sort((a,b)=>b.start-a.start);
  for(const edit of changes){assert.ok(edit.end<=previousStart,'Overlapping edits '+file);assert.equal(text.slice(edit.start,edit.end),edit.before);text=text.slice(0,edit.start)+edit.after+text.slice(edit.end);previousStart=edit.start;}
  parse(text,{sourceType:'unambiguous',plugins:['jsx','importAttributes'],allowReturnOutsideFunction:true});
  editedFiles.push({path:file,destination:destination(file),baselineHash:hash(source(file)),plannedHash:hash(text),editIds:changes.map(e=>e.edgeId),syntax:'in-memory parse only'});
}
const files=selected.map(f=>({path:f.path,sha256:hash(source(f.path)),layer:f.layer,context:f.context,rank:f.rank,
  destination:retired.has(f.path)?null:f.path===strings?f.path:moves.get(f.path),
  action:retired.has(f.path)?'retire after all code/tool/mock/reference gates; no compatibility copy':f.path===strings?'retain untouched; no current caller beyond retiring barrel, not a prerequisite move':'relocate one canonical implementation',
  publicEntries:facades.filter(p=>p.target===moves.get(f.path)).map(p=>p.entry),
  privateExports:f.exports.filter(e=>!publicByOrigin.has(origin(f.path,e.name).file+':'+origin(f.path,e.name).name)).map(e=>e.name)}));
const dispositionByEdge=new Map(edgeDispositions.map(e=>[e.edgeId,e]));
function closure(start,planned){
  const seen=new Set(),builtins=new Set(),queue=[start];
  while(queue.length){const file=queue.pop();if(seen.has(file))continue;seen.add(file);
    for(const edge of outgoing.get(file)||[]){
      if(edge.kind==='builtin'){builtins.add(edge.specifier);continue;}
      if(edge.kind!=='source')continue;
      const disposition=planned?dispositionByEdge.get(edge.id):null;
      if(disposition?.bindings)queue.push(...disposition.bindings.map(b=>b.origin.file));
      else if(!planned||!retired.has(edge.from))queue.push(edge.target);
    }
  }
  return {files:[...seen].sort(),builtins:[...builtins].sort()};
}
const closureReview={
  originalBroadBarrel:closure(mixed,false),originalErrorBarrel:closure(errorBarrel,false),
  plannedEntries:specs.map(spec=>({entry:'@daylight/platform/'+spec.subpath,...closure(spec.file,true)})),
  status:'planned source-edge closure only; does not execute imports, resolve installed packages or prove runtime identity'};
for(const entry of closureReview.plannedEntries){
  assert.ok(!entry.files.some(f=>retired.has(f)||f.endsWith('/FileIO.mjs')),'Utility entry retains mixed/IO closure '+entry.entry);
  if(/\/(configuration|scheduler|event-bus|file-io)-error$/.test(entry.entry))assert.equal(entry.files.length,1);
  if(entry.entry.includes('/domain/'))assert.ok(entry.files.every(f=>f.startsWith(core)));
}
const caseIds=['CASE-UTILITY-PURE-TIME','CASE-UTILITY-CLOCK','CASE-UTILITY-ID','CASE-UTILITY-ERROR-IDENTITY','CASE-UTILITY-INFRA-ERROR','CASE-UTILITY-VENDOR'];
const cases=caseIds.map(id=>{const found=catalog.cases.find(c=>c.id===id);assert.ok(found,'Missing executed utility case '+id);assert.equal(found.baselineResult,'passed');return {id,evidence:found.evidence};});
const packageFragments={publicPackage:{path:'platform/public/package.json',name:'@daylight/platform',
  exports:Object.fromEntries(facades.map(f=>['./'+f.entry.slice('@daylight/platform/'.length),'./'+f.path.slice('platform/public/'.length)])),
  dependency:{name:'@daylight-internal/platform--server',version:'0.0.0'}},
  serverPackage:{path:'platform/server/package.json',name:'@daylight-internal/platform--server',
    exports:Object.fromEntries(facades.map(f=>['./'+f.privateEntry.slice('@daylight-internal/platform--server/'.length),'./'+f.target.slice('platform/server/'.length)]))},
  status:'fragments only, not whole manifests; reconcile other foundation entries, version, deps, workspace/lock and native/browser build'};
const gates=[
  {id:'UTILITY-GATE-REFERENCES',owner:'build/test reviewer',required:'Reconcile mock targets, source-text/AST assertions, scripts, operator paths and documentation before retiring old barrels; import graph is not the full path-reference population.'},
  {id:'UTILITY-GATE-PACKAGE',owner:'package reviewer',required:'Merge these fragments into full platform sibling manifests; root/backend/frontend dependencies, lock/install, public classification and loaded identity must be proved with real resolvers. No aliases or shims to retained implementations.'},
  {id:'UTILITY-GATE-LAYERS',owner:'architecture reviewer',required:'D4 explicit core rank-0 time dependency does not license arbitrary system-to-domain imports. Preserve D8 LA defaults. Runtime entropy/clock and clocked infrastructure errors never become pure domain exports; enforce actual transitive target classification.'},
  {id:'UTILITY-GATE-COMBINED',owner:'implementation reviewer',required:'Rebase these source-addressed edits over Feed/Homebot/household and source moves, then parse and verify the complete candidate. Individual in-memory syntax is not the full combined changeset.'},
  {id:'UTILITY-GATE-IDENTITY',owner:'test reviewer',required:'Run original/selected affected consumer suites plus candidate public/private constructor and time binding identity; demonstrate deliberate duplicate-class, UTC-default and wrong-time-helper mutations fail. New utility negative controls are specified, not run.'},
];
emit('utility-boundary.json',{schema:'daylight.preimplementation.utility-boundary/v1',baseline:foundation.baseline,
  status:'selected utility source/export/import design; whole foundation and migration approval remain open',
  supersedes:'For these 17 candidate paths, this specification refines boundary-review.json generated proposals; neither inventory count is blanket move authority.',
  files,facades,packageFragments,edits,editedFiles,edgeDispositions,baselineDefects,closureReview,documentedConsumers,cases,
  stats:{selectedFiles:files.length,relocations:moves.size,retiredBarrels:retired.size,retainedLeaves:1,publicEntries:facades.length,
    publicSymbols:publicByOrigin.size,incomingEdges:edgeDispositions.length,externalEdges:external.length,
    broadBarrelImports:external.filter(e=>e.target===mixed).length,dynamicImports:dynamic.length,
    editGroups:edits.length,editedFiles:editedFiles.length},
  exportNotes:['No public system utils/error aggregate; no speculative default, ShortId, IdUtils, TimeUtils or unused error predicate export.',
    'Private leaf defaults/objects remain unchanged. The ShortId alias only occurs in the retired unused export, not a current external consumer.',
    'Pure parseToDate is an imported binding re-exported by the clock module; publish its pure origin to preserve the active documented adapter API. Runtime formatLocalTimestamp is a different wrapper with a clock default.',
    'file-io-error explicitly replaces the generated file-ioerror spelling. FileIO itself is a separate system boundary with D5/D10 restrictions.',
    'Pure three-class domain error aggregate remains valid; four infrastructure-free system error classes have individual entries so config import does not load the clock/IO closure.'],
  gates,inputs:[...inputs.values()],inventoryInputs:['boundary-review.json','dependency-ledger.json','owner-boundaries.json','contracts.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({files:files.length,publicEntries:facades.length,publicSymbols:publicByOrigin.size,
  incomingEdges:edgeDispositions.length,editGroups:edits.length,editedFiles:editedFiles.length,cases:cases.length})+'\n');
