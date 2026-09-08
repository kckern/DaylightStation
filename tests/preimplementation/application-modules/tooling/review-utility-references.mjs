/** Literal, comment, mock and constructed-path inventory; no source evaluation or edits. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root,packet,emit} from './census.mjs';
assert.ok(process.env.PRE_TOOLCHAIN_ROOT,'Explicit parser toolchain required');
const require=createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT,'package.json'));
const {parse}=require('@babel/parser');
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const hash=value=>createHash('sha256').update(value).digest('hex');
const utility=read('utility-boundary.json'),ledger=read('source-ledger.json');
const graph=read('dependency-ledger.json');
const selected=new Map(utility.files.map(f=>[f.path,f])),inputs=[],references=[],constructions=[],parseErrors=[];
const sources=new Map(),parsedFiles=new Set(),scan={regularText:0,binary:0,symlinks:0,parsed:0};
const aliases=[['#system/','backend/src/0_system/'],['#domains/','backend/src/2_domains/'],['@backend/','backend/']];
const knownBasenames=new Set(utility.files.map(f=>path.posix.basename(f.path)));
const tokenPattern=/(?:#(?:system|domains)\/|@backend\/|(?:\.\.?\/)+|(?:backend\/src\/|0_system\/|2_domains\/))[A-Za-z0-9_./-]+/g;
function target(file,token){
  let value=token;
  for(const [alias,prefix] of aliases)if(value.startsWith(alias)){value=prefix+value.slice(alias.length);break;}
  if(value.startsWith('.'))value=path.posix.normalize(path.posix.join(path.posix.dirname(file),value));
  else if(value.startsWith('0_system/')||value.startsWith('2_domains/'))value='backend/src/'+value;
  value=value.replace(/\/$/,'');
  return [value,value+'.mjs',value+'/index.mjs'].find(p=>selected.has(p))||null;
}
function walk(node,ancestors,visit){if(!node||typeof node!=='object')return;if(node.type)visit(node,ancestors);
  for(const [key,value] of Object.entries(node)){
    if(['loc','comments','tokens','extra','leadingComments','trailingComments','innerComments'].includes(key))continue;
    if(Array.isArray(value))value.forEach(n=>walk(n,[...ancestors,node],visit));
    else if(value&&typeof value==='object')walk(value,[...ancestors,node],visit);
  }
}
const specialComments=new Map([
  ['backend/src/0_system/utils/errors/vendorError.mjs:1','platform/server/system/utils/errors/vendorError.mjs'],
  ['backend/src/0_system/utils/time.mjs:6','platform/server/domain/core/utils/time.mjs'],
  ['backend/src/1_adapters/persistence/yaml/YamlObservationStore.mjs:95','@daylight/platform/server/domain/core/utils/time'],
  ['backend/src/1_adapters/persistence/yaml/YamlObservationStore.mjs:392','@daylight/platform/server/domain/core/utils/time'],
  ['backend/src/2_domains/nutrition/services/ObservationMatcher.mjs:71','@daylight/platform/server/domain/core/utils/time'],
  ['backend/src/3_applications/school/usecases/CloseAcademicPeriod.mjs:50','@daylight/platform/server/domain/core/errors'],
  ['backend/src/0_system/http/middleware/errorHandler.mjs:33','@daylight/platform/server/domain/core/errors'],
  ['tests/isolated/domain/school/errors.test.mjs:7','platform/server/domain/core/errors/'],
]);
const mockFiles=new Set(['backend/src/4_api/v1/routers/piano.effect-audit.test.mjs','backend/src/4_api/v1/routers/piano.history.test.mjs']);
const toolingTest='tests/unit/tooling/auditLayerImports.test.mjs';
const edits=[];
for(const file of ledger.files.filter(f=>f.protected)){
  if(file.mode==='120000'){scan.symlinks++;continue;}
  const bytes=fs.readFileSync(path.join(root,file.path));
  assert.equal(hash(bytes),file.sha256,'Protected source differs from inventory: '+file.path);
  const isJS=/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(file.path);
  let text;try{if(bytes.includes(0)&&!isJS)throw new Error('binary');text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{scan.binary++;continue;}
  scan.regularText++;sources.set(file.path,text);
  let tree=null,literals=[],comments=[];
  if(isJS){
    try{
      tree=parse(text,{sourceType:'unambiguous',plugins:['jsx',...(/\.tsx?$/.test(file.path)?['typescript']:[]),'decorators-legacy'],allowReturnOutsideFunction:true});
      parsedFiles.add(file.path);scan.parsed++;comments=tree.comments||[];
      walk(tree,[],(node,ancestors)=>{
        if(node.type==='StringLiteral'||node.type==='TemplateLiteral'&&!node.expressions.length)literals.push({node,ancestors});
        if(!['CallExpression','NewExpression'].includes(node.type))return;
        const name=node.callee.type==='Import'?'import':node.callee.type==='Identifier'?node.callee.name:node.callee.type==='MemberExpression'?node.callee.property.name:null;
        if(!['join','resolve','URL','readFile','readFileSync','load','import','importActual','mock','doMock','unmock','scanViolations','scanAstViolations'].includes(name))return;
        const parts=(node.arguments||[]).flatMap(arg=>arg.type==='StringLiteral'?[arg.value]:arg.type==='TemplateLiteral'?arg.quasis.map(q=>q.value.cooked||q.value.raw):[]);
        // Review split paths as well as whole literals; fragments alone are candidates, not resolved modules.
        if(parts.some(p=>/0_system|2_domains|#system\/utils|#domains\/core/.test(p))||parts.some(p=>knownBasenames.has(p))){
          constructions.push({path:file.path,line:node.loc.start.line,start:node.start,end:node.end,callee:name,
            literalParts:parts,status:'candidate requiring literal/fixture classification; not evaluated'});
        }
      });
    }catch(error){parseErrors.push({path:file.path,line:error.loc?.line,reason:error.reasonCode||error.message});}
  }
  let found=false;
  for(const match of text.matchAll(tokenPattern)){
    const resolved=target(file.path,match[0]);if(!resolved)continue;found=true;
    const start=match.index,end=start+match[0].length,line=text.slice(0,start).split('\n').length;
    const id='UREF-'+hash(file.path+':'+start+':'+resolved).slice(0,16);
    const covered=utility.edits.find(e=>e.path===file.path&&e.start<=start&&e.end>=end);
    const literal=literals.find(l=>l.node.start<=start&&l.node.end>=end),comment=comments.find(c=>c.start<=start&&c.end>=end);
    let disposition,after=null;
    if(covered)disposition={kind:'source-import',policy:'UTILITY-SOURCE-IMPORTS',edgeId:covered.edgeId,action:'exact change already in utility-boundary.json'};
    else if(selected.get(file.path)?.action.startsWith('retire'))disposition={kind:'retiring-source',policy:'UTILITY-RETIRE',action:'removed with the obsolete barrel; no independent replacement'};
    else if(file.path.endsWith('.md')){
      if(file.path==='docs/reference/core/layers-of-abstraction/decision-register.md'){
        disposition={kind:'authoritative-ruling',policy:'UTILITY-RULING',action:'retain D4 wording; record old/new physical location mapping in migration design, never silently rewrite a settled ruling'};
      }else if(file.path.startsWith('docs/reference/')){
        const f=selected.get(resolved),entry=utility.facades.find(p=>p.target===f.destination);
        // Pure core leaf classes use the retained three-class facade.
        after=entry?.entry||(resolved.includes('/core/errors/')?'@daylight/platform/server/domain/core/errors':null);
        if(match[0]==='0_system/utils/')after='platform/server/system/utils/';
        else if(resolved==='backend/src/0_system/utils/index.mjs')after='@daylight/platform/server/system/utils/time';
        if(file.path==='docs/reference/core/adapter-layer-guidelines.md'&&line===83)
          after='@daylight/platform/server/system/utils/time` / `@daylight/platform/server/domain/core/utils/time';
        if(file.path==='docs/reference/core/layers-of-abstraction/system-layer-guidelines.md'&&line===183)after=f.destination;
        disposition={kind:'authoritative-reference',policy:'UTILITY-REFERENCE-DOCS',action:after?'future spelling-only example/link update; preserve all binding rules':'explicit reference review needed; do not infer a symbol from a barrel'};
      }else disposition={kind:'planning-or-history',policy:'UTILITY-HISTORICAL',action:'retain baseline path as evidence; not a live import or instruction to run obsolete code'};
    }else if(file.path===toolingTest){
      disposition={kind:'architecture-fixture',policy:'UTILITY-LEGACY-FIXTURE',action:'retain legacy-path regression fixture; add new-path counterpart under IMP-BASE.02 rather than replacing old coverage'};
    }else if(file.path==='tests/isolated/application/school/schoolcalcArchitecture.test.mjs'){
      disposition={kind:'architecture-filter',policy:'UTILITY-SCHOOL-POLICY',action:'retain current system-utils rejection/allowance contexts; add only classified core-error public support to three filters. Do not allow all @daylight/platform imports.'};
    }else if(file.path==='cli/payroll-sync.cli.mjs'&&comment){
      disposition={kind:'stale-operator-comment',policy:'UTILITY-CLI-COMMENT',action:'comment describes an obsolete resolver/error dependency, not an actual utility import. Retain CLI behavior; separately replace misleading comment without executing payroll/provider code.'};
    }else if(mockFiles.has(file.path)&&literal&&resolved==='backend/src/0_system/utils/id.mjs'){
      const call=literal.ancestors.findLast(n=>n.type==='CallExpression');
      assert.equal(call?.callee?.object?.name,'vi');assert.equal(call?.callee?.property?.name,'mock');
      assert.equal(call.arguments[0],literal.node);
      after='@daylight/platform/server/system/utils/id';
      disposition={kind:'mock-target',policy:'UTILITY-MOCK-IDENTITY',action:'change vi.mock target with production import; preserve factory, hoisting and shortId replacement'};
    }else if(comment&&specialComments.has(file.path+':'+line)){
      after=specialComments.get(file.path+':'+line);
      disposition={kind:'source-comment',policy:'UTILITY-SOURCE-DOCS',action:'update source-location/JSDoc reference only; no behavior or layer change'};
    }else disposition={kind:'unreviewed',policy:'UTILITY-REFERENCE-UNKNOWN',action:'investigate exact source context before approving relocation'};
    const row={id,path:file.path,start,end,line,token:match[0],target:resolved,context:comment?'comment':literal?'literal':'text',disposition};
    if(after){row.proposed=after;edits.push({referenceId:id,path:file.path,start,end,line,before:match[0],after,policy:disposition.policy});}
    references.push(row);
  }
  if(found)inputs.push({path:file.path,sha256:hash(bytes)});
}
assert.equal(parseErrors.length,0,'Reference scan parse failures need disposition');
assert.equal(scan.parsed,ledger.files.filter(f=>f.protected&&f.mode!=='120000'&&/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(f.path)).length,'Incomplete JavaScript/TypeScript scan');
const importIds=new Set(references.filter(r=>r.disposition.kind==='source-import').map(r=>r.disposition.edgeId));
assert.equal(importIds.size,utility.edits.length,'Incomplete exact source-import reference population');
assert.ok(utility.edits.every(e=>importIds.has(e.edgeId)));
for(const construction of constructions){
  const refs=references.filter(r=>r.path===construction.path&&r.start>=construction.start&&r.end<=construction.end);
  construction.referenceIds=refs.map(r=>r.id);
  if(refs.length)construction.status=refs.some(r=>r.disposition.kind==='unreviewed')?'unreviewed literal use':'covered by attached literal/fixture dispositions';
  else if(construction.path===toolingTest)construction.status='other-domain/layer fixture, retain; no selected utility target';
  else if(construction.literalParts.length===1&&construction.literalParts[0]==='#system/utils/FileIO.mjs'){
    const isMock=construction.callee==='mock';assert.ok(isMock||construction.callee==='import','Review additional FileIO reference form');
    construction.status=isMock?'cross-boundary FileIO mock target; explicit further foundation review':'cross-boundary FileIO dynamic import; link existing storage source edge and preserve mock/native identity';
    if(!isMock){const edge=graph.edges.find(e=>e.from===construction.path&&e.line===construction.line&&e.syntax==='dynamic-literal'&&e.target==='backend/src/0_system/utils/FileIO.mjs');
      assert.ok(edge,'FileIO dynamic import not in existing source graph');construction.sourceEdgeId=edge.id;}
    construction.followup={gate:isMock?'FILEIO-MOCK-IDENTITY':'FILEIO-DYNAMIC-IDENTITY',owner:'platform test reviewer',target:'backend/src/0_system/utils/FileIO.mjs',
      candidate:'@daylight/platform/server/system/utils/file-io',required:isMock?'Preserve mock factory/hoisting and map it to the same actual module URL as all affected code consumers; public/private injected IO and original fixture behavior must be checked before adoption.':'Preserve lazy timing, same native or mocked module namespace and installed cache; source edge is already in the FileIO carrier inventory, not an additional import.'};
  }else if(construction.literalParts.every(p=>!knownBasenames.has(p))){
    const ancestors=construction.literalParts.filter(p=>[...selected.keys()].some(f=>f.startsWith(p.replace(/\/$/,'')+'/')));
    construction.status=ancestors.length?'directory ancestor of selected utilities; scanner/predicate adoption remains a broader gate':'other source-tree construction outside selected utility files; retain or coordinate with its named broader gate';
    construction.followup={gate:ancestors.length||construction.path==='scripts/audit-api-route-surface.mjs'?'IMP-BASE.02':'OWNER-SOURCE-PATHS',
      owner:'build or named owner reviewer',required:'Retain unrelated source targets; global directory scanner adoption is still a separate gate.'};
  }else construction.status='unreviewed split-path or unrelated-fragment candidate';
}
const policyEdits=[];
const schoolPolicy='tests/isolated/application/school/schoolcalcArchitecture.test.mjs';
const schoolSource=sources.get(schoolPolicy),coreEntry='@daylight/platform/server/domain/core/errors';
assert.ok(utility.facades.some(f=>f.entry===coreEntry&&f.layer==='domain'&&f.context==='core'&&f.rank===0));
const oldPredicate="specifier.startsWith('#domains/')",matches=[...schoolSource.matchAll(/specifier\.startsWith\('#domains\/'\)/g)];
assert.equal(matches.length,3,'School domain/application/adapter predicate population changed');
for(const match of matches)policyEdits.push({referenceId:references.find(r=>r.path===schoolPolicy&&r.disposition.policy==='UTILITY-SCHOOL-POLICY').id,
  path:schoolPolicy,start:match.index,end:match.index+oldPredicate.length,line:schoolSource.slice(0,match.index).split('\n').length,
  before:oldPredicate,after:`(${oldPredicate} || specifier === '${coreEntry}')`,policy:'UTILITY-SCHOOL-POLICY'});
const payroll='cli/payroll-sync.cli.mjs',payrollSource=sources.get(payroll);
const oldComment="// Use the backend's module resolution by importing through its src tree.\n// The CLI runs with cwd at the project root, but # aliases need backend.\n// Workaround: dynamic import with relative paths — these don't trigger\n// alias resolution in PayrollSyncService (which uses #system/utils for\n// errors). To make this work, we set the cwd and use the backend package.";
assert.equal(payrollSource.split(oldComment).length,2);
const payrollStart=payrollSource.indexOf(oldComment);
policyEdits.push({referenceId:references.find(r=>r.path===payroll).id,path:payroll,start:payrollStart,end:payrollStart+oldComment.length,
  line:payrollSource.slice(0,payrollStart).split('\n').length,before:oldComment,
  after:"// Load retained backend modules through their source paths.\n// Preserve this CLI's existing working-directory change; package migration\n// must verify its resolver and provider setup separately.",policy:'UTILITY-CLI-COMMENT'});
assert.ok(!sources.get('backend/src/3_applications/finance/PayrollSyncService.mjs').includes("from '#system/utils"));
inputs.push({path:'backend/src/3_applications/finance/PayrollSyncService.mjs',sha256:hash(sources.get('backend/src/3_applications/finance/PayrollSyncService.mjs'))});
edits.push(...policyEdits);
// Planned edits are source-addressed independently of ordinary import edits.
const editedFiles=[];
for(const file of [...new Set(edits.map(e=>e.path))].sort()){
  let text=sources.get(file),last=Infinity;
  for(const edit of edits.filter(e=>e.path===file).sort((a,b)=>b.start-a.start)){
    assert.ok(edit.end<=last);assert.equal(text.slice(edit.start,edit.end),edit.before);
    text=text.slice(0,edit.start)+edit.after+text.slice(edit.end);last=edit.start;
  }
  if(parsedFiles.has(file))parse(text,{sourceType:'unambiguous',plugins:['jsx','decorators-legacy'],allowReturnOutsideFunction:true});
  editedFiles.push({path:file,sourceSha256:hash(sources.get(file)),plannedSha256:hash(text),syntax:parsedFiles.has(file)?'in-memory parse only':'documentation string edits only'});
}
const policies=[
  {id:'UTILITY-SOURCE-IMPORTS',rule:'Reuse exact source-import edge, not a duplicate edit.'},
  {id:'UTILITY-RETIRE',rule:'Private barrel reference disappears only after complete retirement gates.'},
  {id:'UTILITY-MOCK-IDENTITY',rule:'Same mock factory and hoisting; mock must address the same public module URL the retained Piano code uses. Actual Vitest identity and existing fixture failures remain separate checks.'},
  {id:'UTILITY-LEGACY-FIXTURE',rule:'Old logical paths remain valid regression inputs during partial migration. New-path tests supplement them; no fixture rewrite that loses old coverage.'},
  {id:'UTILITY-SOURCE-DOCS',rule:'Source/JSDoc spelling changes travel with code; no contract, API or layer change.'},
  {id:'UTILITY-REFERENCE-DOCS',rule:'Update live reference examples/links only in a separately approved implementation changeset; D1-D10 and semantic guidance unchanged.'},
  {id:'UTILITY-HISTORICAL',rule:'Dated planning/audit/roadmap examples retain historical source spellings; they are not runtime module consumers.'},
  {id:'UTILITY-RULING',rule:'D4 is authoritative and unchanged; path migration mapping does not change its permitted dependency.'},
  {id:'UTILITY-SCHOOL-POLICY',rule:'Retained School domain/application/adapter filters need exact core-error facade awareness, not a platform-wide allowlist.'},
  {id:'UTILITY-CLI-COMMENT',rule:'Obsolete source comment is not evidence of runtime dependency; any cleanup remains comment-only and separately approved.'},
  {id:'UTILITY-REFERENCE-UNKNOWN',rule:'Missing semantic disposition blocks reference approval, even if scans parse.'},
];
const unknown=references.filter(r=>r.disposition.kind==='unreviewed');
emit('utility-reference-review.json',{schema:'daylight.preimplementation.utility-reference-review/v1',baseline:utility.baseline,
  status:'source-only literal/mock/comment/fixture census; exact known changes, unresolved construction candidates explicit',
  scope:{protectedFiles:ledger.files.filter(f=>f.protected).length,...scan,
    method:'All protected regular UTF-8 text scanned; non-JavaScript NUL content excluded as binary. JavaScript/TypeScript with embedded NUL strings still parsed. Tokens resolve root/known # aliases/module-relative forms; likely path-constructor fragments inspected separately. No filesystem resolver or module evaluator invoked.',
    limits:'No claim to arbitrary computed/eval/runtime-generated paths, external untracked scripts, installed loader behavior or successful existing test execution. FileIO and wider platform directory/glob effects remain their own gates.'},
  references,constructions,policies,edits,policyEdits,editedFiles,unknown,parseErrors,
  inputs,inventoryInputs:['source-ledger.json','dependency-ledger.json','utility-boundary.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({scan,references:references.length,referenceFiles:new Set(references.map(r=>r.path)).size,
  kinds:references.reduce((m,r)=>(m[r.disposition.kind]=(m[r.disposition.kind]||0)+1,m),{}),edits:edits.length,editedFiles:editedFiles.length,
  unknown:unknown.map(r=>({path:r.path,line:r.line,token:r.token,context:r.context})),
  unresolvedConstructions:constructions.filter(c=>c.status.startsWith('unreviewed')).map(c=>({path:c.path,line:c.line,callee:c.callee,literalParts:c.literalParts}))})+'\n');
