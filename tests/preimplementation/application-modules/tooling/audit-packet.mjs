/** Verify current evidence, protected bytes/modes and accountable checklist links. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { root, packet, emit } from './census.mjs';
import { validateRenderingIdentity } from './validate-rendering-identity.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = read('baseline.json'),
  source = read('source-ledger.json'),
  status = read('task-status.json'),
  reviewedExits = read('reviewed-exits.json');
const problems = [];
const derived = [
  ['assembled-api.json', 'assemble-api.mjs', 'repository'],
  ['api-registration-audit.json', 'review-api-closure.mjs', 'repository'],
  ['provider-lifecycle-review.json', 'review-provider-lifecycle.mjs', 'repository'],
  ['lifecycle-closure.json', 'review-lifecycle-closure.mjs', 'repository'],
  ['storage-authorities.json', 'review-storage-authorities.mjs', 'repository'],
  ['storage-consumer-review.json', 'review-storage-consumers.mjs', 'repository'],
  ['feed-boundary.json', 'review-feed-boundary.mjs', 'repository'],
  ['homebot-boundary.json', 'review-homebot-boundary.mjs', 'repository'],
  ['household-boundary.json', 'review-household-boundary.mjs', 'repository'],
  ['utility-boundary.json', 'review-utility-boundary.mjs', 'repository'],
  ['utility-reference-review.json', 'review-utility-references.mjs', 'repository'],
  ['combined-boundary-review.json', 'review-combined-boundaries.mjs', 'repository'],
  ['fileio-mock-review.json', 'review-fileio-mocks.mjs', 'repository'],
  ['fileio-boundary.json', 'review-fileio-boundary.mjs', 'repository'],
  ['fileio-reference-review.json', 'review-fileio-references.mjs', 'repository'],
  ['http-boundary.json', 'review-http-boundary.mjs', 'repository'],
  ['logging-boundary.json', 'review-logging-boundary.mjs', 'repository'],
  ['rendering-boundary.json', 'review-rendering-boundary.mjs', 'repository'],
  ['rendering-consumer-review.json', 'review-rendering-consumers.mjs', 'repository'],
  ['resource-review.json', 'review-resources.mjs', 'repository'],
  ['wire-contract-review.json', 'review-wire-contracts.mjs', 'repository'],
  ['contract-catalog-review.json', 'review-contract-catalog.mjs', 'repository'],
  ['case-oracle-review.json', 'review-case-oracles.mjs', 'repository'],
  ['assembled-browser.json', 'assemble-browser.mjs', 'repository'],
  ['boundary-review.json', 'review-boundaries.mjs', 'packet'],
];
for (const [name, tool, inputBase] of derived) {
  if(!fs.existsSync(path.join(packet,name))){problems.push('missing derived artifact: '+name);continue;}
  const report = read(name);
  const toolFile = path.join(root, 'tests/preimplementation/application-modules/tooling', tool);
  if (report.toolHash !== hash(fs.readFileSync(toolFile))) problems.push('stale derived tool: ' + name);
  for (const input of report.inputs || []) {
    const full = path.join(inputBase === 'packet' ? packet : root, input.name || input.path);
    if (!fs.existsSync(full) || hash(fs.readFileSync(full)) !== input.sha256) problems.push('stale derived input: ' + name + ':' + (input.name || input.path));
  }
  for (const input of report.inventoryInputs || []) if (hash(fs.readFileSync(path.join(packet, input.name))) !== input.sha256)
    problems.push('stale derived inventory: ' + name + ':' + input.name);
  for (const input of report.toolchainInputs || []) {
    const full=process.env.PRE_TOOLCHAIN_ROOT&&path.join(process.env.PRE_TOOLCHAIN_ROOT,input.name);
    if(!full||!fs.existsSync(full)||hash(fs.readFileSync(full))!==input.sha256)problems.push('stale derived toolchain input: '+name+':'+input.name);
  }
}
const assembled = read('assembled-api.json'), browserAssembly = read('assembled-browser.json');
const storageConsumers=read('storage-consumer-review.json');
const storageEdges=storageConsumers.consumers.flatMap(c=>c.edges.map(e=>e.id));
const graphEdges=read('dependency-ledger.json').edges.filter(e=>storageConsumers.carriers.some(c=>c.file===e.target));
if(storageConsumers.primitives.length!==77||new Set(storageConsumers.primitives.map(p=>p.name)).size!==77
  ||storageEdges.length!==graphEdges.length||new Set(storageEdges).size!==storageEdges.length
  ||graphEdges.some(e=>!storageEdges.includes(e.id)))problems.push('storage primitive/carrier edge population mismatch');
const indirectProduction=storageConsumers.uses.filter(u=>u.kind!=='direct call'
  &&!u.source.path.startsWith('tests/')&&!u.source.path.startsWith('backend/tests/')&&!/\.(?:test|spec)\./.test(u.source.path));
if(indirectProduction.length!==51||indirectProduction.some(u=>!storageConsumers.nonCallPolicies.some(p=>p.id===u.referencePolicy)))
  problems.push('storage indirect production reference missing disposition');
const moveImpact=storageConsumers.firstMoveImpact;
if(!moveImpact)problems.push('missing first-move storage path dispositions');
else{
  const allConsumers=[...moveImpact.movingConsumers,...moveImpact.retainedConsumers];
  const movingCalls=storageConsumers.uses.filter(u=>u.kind==='direct call'&&moveImpact.movingConsumers.some(c=>c.path===u.source.path));
  const classifiedCalls=moveImpact.pathPolicies.flatMap(p=>p.callSites.map(c=>c.call.path+':'+c.call.start));
  if(allConsumers.length!==storageConsumers.consumers.length||new Set(allConsumers.map(c=>c.path)).size!==allConsumers.length
    ||storageConsumers.consumers.some(c=>!allConsumers.some(m=>m.path===c.path&&m.directCalls===c.directCalls))
    ||classifiedCalls.length!==movingCalls.length||new Set(classifiedCalls).size!==classifiedCalls.length
    ||movingCalls.some(c=>!classifiedCalls.includes(c.call.path+':'+c.call.start)))problems.push('first-move storage consumer/call population mismatch');
}
const ownerBoundary=read('owner-boundaries.json'),printBoundary=ownerBoundary.publicEntries.find(e=>e.entry==='@daylight/gratitude/server/adapters/image-print-gateway');
const selectedPrintImports=read('import-replacements.json').entries.filter(e=>e.decision==='DEC-PRINT-EXPORT');
if(!printBoundary||printBoundary.layer!=='adapter'||selectedPrintImports.length!==5
  ||selectedPrintImports.some(e=>!e.selectedSpecifier||e.selectedSpecifier.includes('#apps/'))
  ||!selectedPrintImports.some(e=>e.from==='backend/src/5_composition/modules/fitnessApi.mjs'&&e.selectedSpecifier===printBoundary.entry))
  problems.push('selected image-print public boundary/import population mismatch');
if(fs.existsSync(path.join(packet,'feed-boundary.json'))){
  const feedBoundary=read('feed-boundary.json'),catalog=read('contracts.json');
  if(feedBoundary.cases.length!==12||feedBoundary.edits.length!==10||feedBoundary.newFiles.length!==4
    ||feedBoundary.cases.some(c=>!catalog.cases.some(k=>k.id===c.id&&k.evidence===c.evidence&&k.baselineResult==='passed'))
    ||feedBoundary.newFiles.some(f=>hash(f.sourceText)!==f.sha256||f.owner!=='gratitude'||f.runtime!=='server'||f.context!==null||f.rank!==null)
    ||!ownerBoundary.publicOperations?.some(o=>o.id===feedBoundary.operation.id)
    ||ownerBoundary.publicEntries.some(e=>e.entry==='@daylight/gratitude/server/queries'))
    problems.push('selected Feed operation/source/case specification mismatch');
}
if(fs.existsSync(path.join(packet,'homebot-boundary.json'))){
  const homebot=read('homebot-boundary.json'),catalog=read('contracts.json'),feed=read('feed-boundary.json');
  if(homebot.cases.length!==11||homebot.projectionCases.length!==3||homebot.edits.length!==11||homebot.newFiles.length!==2
    ||[...homebot.cases,...homebot.projectionCases].some(c=>!catalog.cases.some(k=>k.id===c.id&&k.evidence===c.evidence&&k.baselineResult==='passed'))
    ||homebot.newFiles.some(f=>hash(f.sourceText)!==f.sha256||f.owner!=='homebot'||f.runtime!=='server'||f.context!==null||f.rank!==null)
    ||!feed.newFiles.some(f=>f.path===homebot.sharedFactory.path&&f.sha256===homebot.sharedFactory.sha256)
    ||!ownerBoundary.publicOperations?.some(o=>o.id===homebot.operation.id)
    ||ownerBoundary.publicEntries.some(e=>e.entry==='@daylight/gratitude/server/commands'))
    problems.push('selected Homebot command/source/case specification mismatch');
}
if(fs.existsSync(path.join(packet,'household-boundary.json'))){
  const household=read('household-boundary.json'),catalog=read('contracts.json');
  if(household.cases.length!==9||household.browserCases.length!==5||household.edits.length!==18||household.newFiles.length!==7||household.manifests.length!==3
    ||household.combinedEditSequence?.files.length!==10||household.combinedEditSequence?.edits.length!==39||household.combinedEditSequence?.newFiles.length!==13
    ||[...household.cases,...household.browserCases].some(c=>!catalog.cases.some(k=>k.id===c.id&&k.evidence===c.evidence&&k.baselineResult==='passed'))
    ||household.newFiles.some(f=>hash(f.sourceText)!==f.sha256||f.owner!=='household-identity'||f.category!=='capability'||f.context!==null||f.rank!==null)
    ||household.manifests.some(m=>hash(JSON.stringify(m.content))!==m.sha256)
    ||!ownerBoundary.sharedCapabilities?.some(o=>o.id===household.owner.id&&o.publicEntries.length===2))
    problems.push('selected household query/client/source/case specification mismatch');
}
if(fs.existsSync(path.join(packet,'utility-boundary.json'))){
  const utility=read('utility-boundary.json'),catalog=read('contracts.json'),graph=read('dependency-ledger.json');
  const paths=new Set(utility.files.map(f=>f.path)),edges=graph.edges.filter(e=>paths.has(e.target));
  if(utility.files.length!==17||utility.facades.length!==11||utility.edits.length!==541||utility.editedFiles.length!==473
    ||utility.baselineDefects.length!==2||utility.cases.length!==6||utility.edgeDispositions.length!==edges.length
    ||new Set(utility.edgeDispositions.map(e=>e.edgeId)).size!==edges.length
    ||edges.some(e=>!utility.edgeDispositions.some(d=>d.edgeId===e.id))
    ||utility.cases.some(c=>!catalog.cases.some(k=>k.id===c.id&&k.evidence===c.evidence&&k.baselineResult==='passed'))
    ||utility.facades.some(f=>hash(f.sourceText)!==f.sha256||f.owner!=='platform'||f.runtime!=='server'
      ||f.layer==='domain'&&(f.context!=='core'||f.rank!==0))
    ||utility.facades.flatMap(f=>f.names).length!==31||utility.documentedConsumers?.length!==1
    ||utility.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before))
    problems.push('selected utility export/import/case specification mismatch');
}
if(fs.existsSync(path.join(packet,'utility-reference-review.json'))){
  const refs=read('utility-reference-review.json'),utility=read('utility-boundary.json'),graph=read('dependency-ledger.json');
  const imports=refs.references.filter(r=>r.disposition.kind==='source-import');
  const dynamic=refs.constructions.filter(c=>c.followup?.gate==='FILEIO-DYNAMIC-IDENTITY');
  if(refs.scope.parsed!==9273||refs.references.length!==762||refs.edits.length!==26||refs.editedFiles.length!==18
    ||refs.unknown.length||refs.parseErrors.length||refs.constructions.some(c=>c.status.startsWith('unreviewed'))
    ||refs.constructions.filter(c=>c.followup?.gate==='FILEIO-MOCK-IDENTITY').length!==22||dynamic.length!==23
    ||dynamic.some(c=>!graph.edges.some(e=>e.id===c.sourceEdgeId&&e.target==='backend/src/0_system/utils/FileIO.mjs'))
    ||new Set(imports.map(r=>r.disposition.edgeId)).size!==utility.edits.length
    ||utility.edits.some(e=>!imports.some(r=>r.disposition.edgeId===e.edgeId))
    ||refs.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before)
    ||refs.edits.some(e=>e.path==='docs/reference/core/layers-of-abstraction/decision-register.md'))
    problems.push('utility literal/mock/reference population or proposed edit mismatch');
}
if(fs.existsSync(path.join(packet,'combined-boundary-review.json'))){
  const combined=read('combined-boundary-review.json');
  const specs=['utility-boundary.json','utility-reference-review.json','feed-boundary.json','homebot-boundary.json','household-boundary.json','fileio-boundary.json','fileio-reference-review.json','http-boundary.json','logging-boundary.json','rendering-boundary.json'].map(read);
  const proposed=[...specs[0].facades,...specs[2].newFiles,...specs[3].newFiles,...specs[4].newFiles,specs[5].facade,specs[7].facade,...specs[8].facades,...specs[9].newFiles];
  if(combined.sequence.length!==1076||combined.files.length!==835||combined.newFiles.length!==35||combined.overlapFiles.length!==82
    ||combined.verifierControls.length!==4||combined.sequence.length!==specs.reduce((n,s)=>n+s.edits.length,0)
    ||new Set(combined.newFiles.map(f=>f.path)).size!==35
    ||combined.newFiles.some(f=>!proposed.some(p=>p.path===f.path&&p.sha256===f.sha256))
    ||combined.files.some(f=>hash(fs.readFileSync(path.join(root,f.path)))!==f.sourceSha256))
    problems.push('joint utility/reference/integration edit specification mismatch');
}
if(fs.existsSync(path.join(packet,'rendering-boundary.json'))){
  const rendering=read('rendering-boundary.json'),graph=read('dependency-ledger.json');
  const selected=['CanvasFactory.mjs','LayoutHelpers.mjs','TextRenderer.mjs'].map(f=>'backend/src/1_rendering/lib/'+f);
  const incoming=graph.edges.filter(e=>selected.includes(e.target));
  const fontEntry='@daylight/platform/server/system/assets/bundled-fonts';
  const expectedNames={
    '@daylight/platform/server/rendering/canvas-factory':['initCanvas'],
    '@daylight/platform/server/rendering/layout-helpers':['drawDivider','drawBorder','roundRect','drawCover','flipCanvas','formatDuration'],
    '@daylight/platform/server/rendering/text-renderer':['wrapText'],
    [fontEntry]:['bundledFontDirectory'],
  };
  if(rendering.files.length!==3||rendering.files.some(f=>!selected.includes(f.path)||f.layer!=='rendering'||f.owner!=='platform')
    ||rendering.facades.length!==4||rendering.facades.some(f=>JSON.stringify(f.names)!==JSON.stringify(expectedNames[f.entry])||f.layer!==(f.entry===fontEntry?'system':'rendering')
      ||f.sourceText!==`export { ${f.names.join(', ')} } from '${f.privateEntry}';\n`||hash(f.sourceText)!==f.sha256)
    ||rendering.newFiles.length!==5||rendering.newFiles.some(f=>hash(f.sourceText)!==f.sha256||f.owner!=='platform')
    ||rendering.edges.length!==17||incoming.length!==17||new Set(rendering.edges.map(e=>e.edgeId)).size!==17||incoming.some(e=>!rendering.edges.some(d=>d.edgeId===e.id))
    ||rendering.edits.length!==41||rendering.editedFiles.length!==22||rendering.references.length!==123||new Set(rendering.references.map(r=>r.path)).size!==29
    ||rendering.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before)
    ||rendering.references.some(r=>!r.disposition||fs.readFileSync(path.join(root,r.path),'utf8').slice(r.start,r.end)!==r.token
      ||r.editId&&!rendering.edits.some(e=>e.id===r.editId&&e.path===r.path&&e.start<=r.start&&e.end>=r.end))
    ||rendering.scan.protected!==13083||rendering.scan.regularText!==12983||rendering.scan.binary!==98||rendering.scan.symlinks!==2
    ||rendering.fontConsumers.length!==5||rendering.fontConsumers.some(c=>c.editIds.length!==2||c.editIds.some(id=>!rendering.edits.some(e=>e.id===id&&e.path===c.path))
      ||c.entry!==(c.path===selected[0]?'../system/assets/bundledFonts.mjs':fontEntry))
    ||rendering.assetMoves.length!==9||rendering.assetMoves.filter(a=>a.role==='bundled font').length!==7
    ||rendering.assetMoves.some(a=>a.destination!==a.path.replace('backend/assets/fonts/','platform/server/assets/fonts/')||hash(fs.readFileSync(path.join(root,a.path)))!==a.sha256
      ||!source.files.some(f=>f.path===a.path&&f.mode===a.mode&&f.sha256===a.sha256))
    ||rendering.retirement.path!=='backend/src/1_rendering/lib/index.mjs'||rendering.retirement.incomingSourceEdges!==0||graph.edges.some(e=>e.target===rendering.retirement.path)
    ||rendering.retirement.removedOutgoingEdges.length!==3||rendering.toolchainInputs.length!==2
    ||rendering.packageFragments.server.dependencies.canvas!=='^3.2.1'
    ||rendering.dependencyGate.lockedBackendCanvas!=='3.2.3'||rendering.dependencyGate.installedBackendCanvas!=='3.1.0'
    ||rendering.dependencyGate.lockedRootCanvas!=='3.2.1'||rendering.dependencyGate.installedRootCanvas!=='3.2.1')
    problems.push('rendering/font authority, source/reference or dependency specification mismatch');
  for(const f of rendering.editedFiles){
    let text=fs.readFileSync(path.join(root,f.path),'utf8'),last=text.length;
    for(const e of rendering.edits.filter(e=>e.path===f.path).sort((a,b)=>b.start-a.start)){
      if(e.end>last||text.slice(e.start,e.end)!==e.before)problems.push('rendering overlapping/stale edit: '+f.path);
      text=text.slice(0,e.start)+e.after+text.slice(e.end);last=e.start;
    }
    if(hash(text)!==f.proposedSha256)problems.push('rendering planned source hash mismatch: '+f.path);
  }
}
if(fs.existsSync(path.join(packet,'logging-boundary.json'))){
  const logging=read('logging-boundary.json'),graph=read('dependency-ledger.json');
  const runtime=logging.facades.filter(f=>f.usage==='runtime'),testing=logging.facades.filter(f=>f.usage==='test-only');
  const incoming=graph.edges.filter(e=>logging.files.some(f=>f.path===e.target));
  if(logging.files.length!==3||logging.facades.length!==4||runtime.length!==3||runtime.flatMap(f=>f.names).length!==5
    ||testing.length!==1||JSON.stringify(testing[0].names)!==JSON.stringify(['LogDispatcher','LEVEL_PRIORITY','resetLogging'])
    ||logging.edges.length!==37||new Set(logging.edges.map(e=>e.edgeId)).size!==37||incoming.some(e=>!logging.edges.some(d=>d.edgeId===e.id))
    ||logging.edits.length!==32||logging.editedFiles.length!==27||logging.edits.filter(e=>e.kind.startsWith('split')).length!==5
    ||logging.references.length!==91||new Set(logging.references.map(r=>r.path)).size!==42||logging.references.some(r=>!r.disposition)
    ||logging.scan.protected!==13083||logging.scan.regularText!==12983||logging.scan.binary!==98||logging.scan.symlinks!==2
    ||logging.retirement.incomingSourceEdges!==0||graph.edges.some(e=>e.target===logging.retirement.path)
    ||hash(fs.readFileSync(path.join(root,logging.retirement.path)))!==logging.retirement.sha256
    ||logging.files.some(f=>f.owner!=='platform'||f.layer!=='system'||f.context!==null||f.rank!==null||hash(fs.readFileSync(path.join(root,f.path)))!==f.sha256)
    ||logging.facades.some(f=>f.owner!=='platform'||f.layer!=='system'||hash(f.sourceText)!==f.sha256)
    ||logging.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before))
    problems.push('logging selected source/export/reference/test-visibility specification mismatch');
}
if(fs.existsSync(path.join(packet,'http-boundary.json'))){
  const http=read('http-boundary.json');
  if(http.files.length!==4||http.facade.names.length!==4||http.edges.length!==85||http.edits.length!==87||http.editedFiles.length!==84
    ||http.dynamicImports.length!==1||http.originalLoadingClosure.files.length!==21||http.defaultExports.length!==3
    ||hash(http.facade.sourceText)!==http.facade.sha256||http.facade.layer!=='system'||http.facade.runtime!=='server'
    ||http.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before)
    ||http.files.some(f=>f.owner!=='platform'||f.layer!=='system'||f.context!==null||f.rank!==null))
    problems.push('HTTP middleware public/source/closure specification mismatch');
  const guard=http.mountGuard;
  const expectedObservations=[
    ['original-global-mount',true],['import-retarget-preserves-global-predicate',true],['missing-global-mount-rejected',false],
    ['original-folder-no-double-mount',[]],['projected-old-folder-no-double-mount',[]],['old-folder-misses-relocated-duplicate',[]],
    ['expanded-population-catches-relocated-duplicate',['modules/gratitude/server/api/v1/gratitude.mjs']],
    ['expanded-population-retains-old-router-check',['backend/src/4_api/v1/routers/fitness.mjs']],
    ['expanded-population-retains-colocated-test-check',['modules/gratitude/server/api/v1/gratitude.card.test.mjs']],
    ['missing-population-member-rejected','population-mismatch'],['duplicate-population-member-rejected','population-mismatch'],
    ['restored-expanded-population',[]]
  ];
  if(!guard||guard.originalPopulation.length!==191||guard.proposedPopulation.length!==191||guard.retained!==189||guard.moved.length!==2
    ||new Set(guard.proposedPopulation.map(f=>f.path)).size!==191||guard.observations.length!==expectedObservations.length
    ||guard.predicates.length!==2||guard.pathInputs.length!==2
    ||guard.originalPopulation.some(f=>hash(fs.readFileSync(path.join(root,f.path)))!==f.sha256)
    ||guard.proposedPopulation.some(f=>!guard.originalPopulation.some(o=>o.path===f.original&&o.sha256===f.sha256)
      ||f.path!==(ownerBoundary.moves.find(m=>m.old===f.original)?.new||f.original))
    ||guard.predicates.some(p=>fs.readFileSync(path.join(root,guard.test),'utf8').slice(p.start,p.end)!==p.original)
    ||expectedObservations.some(([id,value])=>!guard.observations.some(o=>o.id===id&&JSON.stringify(o.expected)===JSON.stringify(value)&&JSON.stringify(o.actual)===JSON.stringify(value))))
    problems.push('HTTP original mount predicate/population counterexample mismatch');
  if(http.references?.length!==1278||new Set(http.references?.map(r=>r.path)).size!==214
    ||http.scan?.protected!==13083||http.scan?.regularText!==12983||http.scan?.binary!==98||http.scan?.symlinks!==2
    ||new Set(http.references?.map(r=>r.id)).size!==1278
    ||new Set(http.references?.filter(r=>r.editId).map(r=>r.editId)).size!==87
    ||http.references?.some(r=>!r.disposition||fs.readFileSync(path.join(root,r.path),'utf8').slice(r.start,r.end)!==r.token
      ||(r.editId&&!http.edits.some(e=>e.id===r.editId&&e.path===r.path&&e.start<=r.start&&e.end>=r.end))))
    problems.push('HTTP literal/reference coverage or edit provenance mismatch');
  const school=http.schoolGuard,schoolEdit=http.edits.find(e=>e.id==='HTTP-REFERENCE-SCHOOL-GUARD');
  const expectedSchool=[[],[{path:'backend/src/4_api/v1/routers/schoolCalc.mjs',specifier:'@daylight/platform/server/system/http/middleware'}],[],[],
    ...Array.from({length:10},()=>[true,true]),...Array.from({length:3},()=>[false,false]),[]];
  if(!school||school.population.length!==2||school.imports.length!==3||school.observations.length!==18||!schoolEdit
    ||school.population.some(f=>hash(fs.readFileSync(path.join(root,f.path)))!==f.sha256)
    ||fs.readFileSync(path.join(root,school.test),'utf8').slice(school.start,school.end)!==school.original
    ||school.proposed!==school.original.replace(schoolEdit.before,schoolEdit.after)
    ||expectedSchool.some((value,i)=>JSON.stringify(school.observations[i]?.actual)!==JSON.stringify(value)||JSON.stringify(school.observations[i]?.expected)!==JSON.stringify(value)))
    problems.push('SchoolCalc exact middleware permission/corpus counterexample mismatch');
}
if(fs.existsSync(path.join(packet,'fileio-reference-review.json'))){
  const refs=read('fileio-reference-review.json'),io=read('fileio-boundary.json');
  const linked=new Set(refs.references.filter(r=>r.policy==='FILEIO-IMPORT').map(r=>r.editId));
  const guard=refs.guardExperiment;
  if(refs.scan.protected!==13083||refs.scan.regularText!==12983||refs.scan.binary!==98||refs.scan.symlinks!==2
    ||refs.scan.matchingFiles!==388||refs.scan.parsedMatchingFiles!==297||refs.references.length!==778||refs.unknown.length
    ||new Set(refs.references.map(r=>r.id)).size!==778||refs.references.some(r=>!refs.policies.some(p=>p.id===r.policy))
    ||linked.size!==303||io.edits.some(e=>!linked.has(e.id))||refs.edits.length!==7||refs.editedFiles.length!==5
    ||refs.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before)
    ||refs.edits.some(e=>e.path==='docs/reference/core/layers-of-abstraction/decision-register.md'||e.path===io.implementation.from)
    ||guard.observations.length!==17||new Set(guard.observations.map(o=>o.id)).size!==17||guard.observations.some(o=>o.actual!==o.expected)
    ||guard.observations.find(o=>o.id==='retarget-only-red')?.actual!=='FileIO import block'
    ||guard.observations.find(o=>o.id==='restored-public')?.actual!=='passed')
    problems.push('FileIO reference/structural-guard census or edit proof mismatch');
}
if(fs.existsSync(path.join(packet,'fileio-mock-review.json'))){
  const mocks=read('fileio-mock-review.json'),refs=read('utility-reference-review.json');
  const sites=refs.constructions.filter(c=>c.followup?.gate==='FILEIO-MOCK-IDENTITY');
  if(mocks.mocks.length!==22||new Set(mocks.mocks.map(m=>m.path)).size!==22
    ||mocks.summary.testOwnedMockConsumers!==3||mocks.summary.projectedFoundationPrivateReaders!==0
    ||mocks.foundation.originalDirectIOEdges.length!==1||mocks.foundation.utilityProjectedDirectIOEdges.length!==0
    ||mocks.mocks.some(m=>!sites.some(s=>s.path===m.path&&s.start===m.start&&s.end===m.end)
      ||hash(fs.readFileSync(path.join(root,m.path),'utf8').slice(m.start,m.end))!==m.mockCallSha256))
    problems.push('FileIO mock exposure/source disposition mismatch');
}
if(fs.existsSync(path.join(packet,'fileio-boundary.json'))){
  const io=read('fileio-boundary.json'),storage=read('storage-consumer-review.json');
  const expectedEdges=storage.consumers.flatMap(c=>c.edges.map(e=>e.id));
  if(io.facade.names.length!==73||new Set(io.facade.names).size!==73||io.internalOnly.length!==4
    ||io.edits.length!==303||io.editedFiles.length!==281||io.namespaces.length!==5||io.dynamicImports.length!==23
    ||io.edges.length!==321||new Set(io.edges.map(e=>e.edgeId)).size!==321
    ||expectedEdges.some(id=>!io.edges.some(e=>e.edgeId===id))
    ||io.facade.layer!=='system'||io.implementation.changeBody!==false||hash(io.facade.sourceText)!==io.facade.sha256
    ||hash(fs.readFileSync(path.join(root,io.implementation.from)))!==io.implementation.sha256
    ||io.edits.some(e=>fs.readFileSync(path.join(root,e.path),'utf8').slice(e.start,e.end)!==e.before)
    ||io.dynamicImports.some(d=>!io.edits.some(e=>e.id===d.editId&&e.edgeId===d.edgeId)))
    problems.push('FileIO selected public/import/namespace specification mismatch');
}
if (assembled.roots.length !== 79 || new Set(assembled.endpoints.map(e => e.id)).size !== assembled.endpoints.length)
  problems.push('assembled API root/identity mismatch');
if (browserAssembly.routes.length !== 134 || new Set(browserAssembly.routes.map(r => r.id)).size !== 134)
  problems.push('assembled browser declaration/identity mismatch');
if (source.files.length !== source.total || new Set(source.files.map(f => f.path)).size !== source.total) problems.push('source population mismatch');
for (const f of source.files.filter(f => f.protected)) {
  const full = path.join(root, f.path);
  try {
    const stat = fs.lstatSync(full);
    const bytes = f.mode === '120000' ? Buffer.from(fs.readlinkSync(full)) : fs.readFileSync(full);
    if (hash(bytes) !== f.sha256) problems.push('protected bytes changed: ' + f.path);
    if (f.mode === '120000' ? !stat.isSymbolicLink() : Boolean(stat.mode & 0o111) !== (f.mode === '100755')) problems.push('protected mode/type changed: ' + f.path);
  } catch {
    problems.push('protected artifact missing: ' + f.path);
  }
}
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const httpSelection=JSON.parse(fs.readFileSync(path.join(testRoot,'fixtures/http-middleware.json')));
const nativeHttpSelection=JSON.parse(fs.readFileSync(path.join(testRoot,'fixtures/http-identity.json')));
const originalHttpSelection=JSON.parse(fs.readFileSync(path.join(testRoot,'fixtures/server-foundation.json')));
const httpRunnerInputs=['node_modules/@babel/parser/lib/index.js','node_modules/@babel/parser/package.json','node_modules/vitest/package.json','node_modules/vitest/vitest.mjs','node_modules/vite/package.json','node_modules/@vitest/mocker/package.json','node_modules/@vitest/runner/package.json'].sort();
const vendorPopulation=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>{
  if(e.isSymbolicLink())throw new Error('Unexpected UUID vendor symlink');
  const file=path.join(directory,e.name);
  return e.isDirectory()?vendorPopulation(file):[path.relative(process.env.PRE_TOOLCHAIN_ROOT,file)];
}).sort();
const currentUuidPopulation=process.env.PRE_TOOLCHAIN_ROOT?vendorPopulation(path.join(process.env.PRE_TOOLCHAIN_ROOT,'backend/node_modules/uuid')):[];
const historical = fs.readdirSync(path.join(packet, 'evidence')).filter(f => f.endsWith('.json')).map(file => {
  const run = read('evidence/' + file);
  const minimumInputs = run.schema === 'daylight.preimplementation.package-install/v1' ? 2 : 5;
  const fresh = Array.isArray(run.inputs) && run.inputs.length >= minimumInputs && run.inputs.every(i => {
    const full = path.join(run.inputBase === 'repository root' ? root : testRoot, i.name);
    return fs.existsSync(full) && hash(fs.readFileSync(full)) === i.sha256;
  }) && (!run.pack?.startsWith('fileio-identity')||Array.isArray(run.toolchainInputs)&&run.toolchainInputs.length===7&&Boolean(process.env.PRE_TOOLCHAIN_ROOT)&&run.toolchainInputs.every(i=>{
    const full=path.join(process.env.PRE_TOOLCHAIN_ROOT,i.name);
    return fs.existsSync(full)&&hash(fs.readFileSync(full))===i.sha256;
  })) && (run.pack!=='http-identity'||Array.isArray(run.toolchainInputs)&&run.toolchainInputs.length===197
    &&new Set(run.toolchainInputs.map(i=>i.name)).size===197
    &&JSON.stringify(run.toolchainInputs.filter(i=>i.name.startsWith('backend/node_modules/uuid/')).map(i=>i.name).sort())===JSON.stringify(currentUuidPopulation)
    &&JSON.stringify(run.toolchainInputs.filter(i=>!i.name.startsWith('backend/node_modules/uuid/')).map(i=>i.name).sort())===JSON.stringify(httpRunnerInputs)
    &&Boolean(process.env.PRE_TOOLCHAIN_ROOT)&&run.toolchainInputs.every(i=>{
      const full=path.join(process.env.PRE_TOOLCHAIN_ROOT,i.name);
      return fs.existsSync(full)&&hash(fs.readFileSync(full))===i.sha256;
    })) && (!['rendering-identity','rendering-consumers'].includes(run.pack)||Array.isArray(run.toolchainInputs)&&run.toolchainInputs.length===(run.pack==='rendering-identity'?210:120)
      &&Boolean(process.env.PRE_TOOLCHAIN_ROOT)&&run.toolchainInputs.every(i=>{
        const full=path.join(process.env.PRE_TOOLCHAIN_ROOT,i.name);
        return fs.existsSync(full)&&hash(fs.readFileSync(full))===i.sha256;
      }));
  let fileioExperimentPassed=null;
  if(run.pack?.startsWith('fileio-identity')){
    const required=['native-initial','native-duplicate-red','native-restored','vitest-public-mock-red','vitest-leaf-partial','vitest-leaf-spread','vitest-public-mock-repeated-red','vitest-leaf-restored'];
    const reds=new Set(['native-duplicate-red','vitest-public-mock-red','vitest-public-mock-repeated-red']);
    const selected=run.pack==='fileio-identity-selected';
    const expectedNames=selected?read('fileio-boundary.json').facade.names:
      [...fs.readFileSync(path.join(root,'backend/src/0_system/utils/FileIO.mjs'),'utf8').matchAll(/^export (?:async )?function (\w+)/gm)].map(m=>m[1]);
    const expectedPrivate=selected?['createImageIO','findYamlByPrefix','isFile','resolveContainedYaml']:[];
    const nativePassed=r=>{
      try {
        const proof=JSON.parse(r.stdout);
        return proof.names===expectedNames.length&&proof.privateNames===77
          &&JSON.stringify(proof.privateOnly?.sort())===JSON.stringify(expectedPrivate)
          &&proof.bindingsIdentical===true&&proof.namespacesDistinct===true
          &&proof.dynamicIdentity===true&&proof.sharedDirectoryReads===1&&proof.privatePathRejected===true;
      } catch { return false; }
    };
    fileioExperimentPassed=run.exitCode===0&&run.outcome?.passed===true
      &&JSON.stringify(run.outcome.records?.map(r=>r.label))===JSON.stringify(required)
      &&JSON.stringify(run.outcome.exportedNames?.slice().sort())===JSON.stringify(expectedNames.slice().sort())
      &&run.outcome.records.every(r=>r.exitCode===(reds.has(r.label)?1:0)&&r.expectedExit===r.exitCode&&r.expectedDiagnostic&&r.populationMatches
        &&(!['native-initial','native-restored'].includes(r.label)||nativePassed(r))
        &&(r.label!=='native-duplicate-red'||r.stderr.includes('FILEIO_BINDING_IDENTITY'))
        &&(!r.label.startsWith('vitest-')||r.outcome?.numTotalTests===3&&r.outcome.numFailedTests===(reds.has(r.label)?1:0)
          &&JSON.stringify(r.outcome.testResults.flatMap(s=>s.assertionResults).map(a=>a.title.split(':')[0]).sort())===JSON.stringify(['FILEIO_MOCK_DYNAMIC','FILEIO_MOCK_EXTERNAL','FILEIO_MOCK_INTERNAL'])
          &&r.outcome.testResults.flatMap(s=>s.assertionResults).every(a=>a.status===(reds.has(r.label)&&a.title.startsWith('FILEIO_MOCK_INTERNAL:')?'failed':'passed'))));
  }
  let loggingExperimentPassed=null;
  if(run.pack==='logging-identity'){
    const required=['native-initial','duplicate-dispatcher-red','native-restored','leaked-test-exports-red','native-final-restored'];
    const ids=['LOGGING-PUBLIC-EXPORTS','LOGGING-BINDING','LOGGING-NAMESPACE','LOGGING-PREINIT','LOGGING-LATE-DISPATCH','LOGGING-TIMESTAMP-PRECEDENCE','LOGGING-GLOBAL-TIMEZONE','LOGGING-RESET-LIFETIME','LOGGING-SAMPLING-STATE','LOGGING-FLUSH-FAILURES','LOGGING-SEND-FAILURE','LOGGING-MUTABLE-PRIORITY'];
    const logging=read('logging-boundary.json');
    loggingExperimentPassed=run.exitCode===0&&run.outcome?.passed===true
      &&JSON.stringify(run.outcome.records?.map(r=>r.label))===JSON.stringify(required)
      &&JSON.stringify(run.outcome.originalBodies)===JSON.stringify(logging.files.map(f=>({path:f.path,sha256:f.sha256})))
      &&JSON.stringify(run.outcome.facadeHashes)===JSON.stringify(logging.facades.map(f=>({path:f.path,sha256:f.sha256})))
      &&run.outcome.records.every(r=>r.expectedDiagnostic&&r.expectedExit===r.exitCode&&(
        r.label==='duplicate-dispatcher-red'?r.exitCode===1&&r.stderr.includes('LOGGING-BINDING'):
        r.label==='leaked-test-exports-red'?r.exitCode===1&&r.stderr.includes('LOGGING-PUBLIC-EXPORTS'):
        r.exitCode===0&&r.result?.passed===true&&r.result.count===12&&JSON.stringify(r.result.ids)===JSON.stringify(ids)));
  }
  let httpPopulationMatches=null,httpMutationDetected=null;
  if(run.pack==='http-middleware'){
    const ids=[...(run.passed||[]),...(run.failed||[])].map(t=>t.split(' ')[0]).sort();
    httpPopulationMatches=run.populationMatches===true&&httpSelection.caseIds.length===37
      &&JSON.stringify(ids)===JSON.stringify([...httpSelection.caseIds].sort())
      &&['skipped','todo','cancelled'].every(k=>run.incompleteCounts?.[k]===0)
      &&/^# tests 37$/m.test(run.stdout)&&run.sourceClosure?.length===21;
    if(run.mutation){
      const expected=httpSelection.mutations[run.mutation];
      httpMutationDetected=Boolean(expected)&&httpPopulationMatches&&run.exitCode===1
        &&run.stderr.includes('"controlledHttpMutation":"'+run.mutation+'"')
        &&JSON.stringify((run.failed||[]).map(t=>t.split(' ')[0]).sort())===JSON.stringify([...expected.expectedFailedIds].sort());
    }
  }
  let httpIdentityExperimentPassed=null;
  if(run.pack==='http-identity'){
    try {
      const h=read('http-boundary.json'),u=read('utility-boundary.json'),l=read('logging-boundary.json'),refs=read('utility-reference-review.json');
      const utilityPaths=['backend/src/0_system/utils/errors/InfrastructureError.mjs','backend/src/0_system/utils/time.mjs','backend/src/2_domains/core/utils/time.mjs','backend/src/2_domains/core/utils/timezone.mjs'];
      const selected=[...h.files,...l.files,...u.files.filter(f=>utilityPaths.includes(f.path))];
      const facades=[h.facade,...l.facades,...u.facades.filter(f=>selected.some(s=>s.destination===f.target))];
      const changes=[...u.edits,...refs.edits,...h.edits,...l.edits].filter(e=>selected.some(f=>f.path===e.path));
      const expectedPlan=selected.map(f=>{
        let text=fs.readFileSync(path.join(root,f.path),'utf8');
        const edits=changes.filter(e=>e.path===f.path).map(e=>({start:e.start,end:e.end,before:e.before,after:e.after}));
        for(const e of [...edits].sort((a,b)=>b.start-a.start)){
          if(text.slice(e.start,e.end)!==e.before)throw new Error('Native HTTP source anchor mismatch');
          text=text.slice(0,e.start)+e.after+text.slice(e.end);
        }
        return {path:f.path,destination:f.destination,originalSha256:f.sha256,proposedSha256:hash(text),edits};
      });
      const expectedFacades=facades.map(f=>({path:f.path,sha256:f.sha256}));
      const o=run.outcome;
      const labels=['native-initial','contracts-initial','originals-initial','duplicate-middleware-red','middleware-restored','duplicate-error-red','error-restored','duplicate-dispatcher-red','dispatcher-restored','leaked-default-red','native-final-restored','contracts-final-restored','originals-final-restored'];
      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const parse=createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT,'package.json'))('@babel/parser').parse;
      const joint=read('combined-boundary-review.json');
      const expectedOriginalPlan=originalHttpSelection.files.map(f=>{
        const original=fs.readFileSync(path.join(root,f.path),'utf8');
        const imports=s=>parse(s,{sourceType:'module'}).program.body.filter(n=>n.type==='ImportDeclaration');
        const oldImports=imports(original),edits=[...h.edits,...l.edits].filter(e=>e.path===f.path).map(({id,start,end,before,after})=>({id,start,end,before,after}));
        let text=original,last=original.length;
        for(const e of [...edits].sort((a,b)=>b.start-a.start)){
          if(e.end>last||!oldImports.some(n=>e.start>=n.start&&e.end<=n.end)||text.slice(e.start,e.end)!==e.before)throw new Error('Original suite import anchor mismatch');
          text=text.slice(0,e.start)+e.after+text.slice(e.end);last=e.start;
        }
        const newImports=imports(text),binding=nodes=>nodes.flatMap(n=>n.specifiers.map(s=>[s.local.name,s.imported?.name||s.type])).sort((a,b)=>a[0].localeCompare(b[0]));
        const prelude=s=>s.slice(0,imports(s)[0].start),body=s=>s.slice(imports(s).at(-1).end);
        const projected=joint.files.find(j=>j.path===f.path);
        if(hash(original)!==projected?.sourceSha256||hash(text)!==projected.plannedSha256||prelude(original)!==prelude(text)||body(original)!==body(text)
          ||!same(binding(oldImports),binding(newImports))||newImports.some(n=>n.source.value!=='vitest'&&!facades.some(f=>f.entry===n.source.value)))throw new Error('Original assertion/body/binding drift');
        for(const s of [original,text])if(parse(s,{sourceType:'module'}).program.body.some(n=>n.type!=='ImportDeclaration'&&n.start<imports(s).at(-1).end))throw new Error('Original body interleaves imports');
        return {path:f.path,destination:f.path,originalSha256:hash(original),proposedSha256:hash(text),unchangedPreludeSha256:hash(prelude(original)),unchangedBodySha256:hash(body(original)),edits};
      });
      if(!/^evidence\/server-foundation-[\dTZ.:-]+\.json$/.test(o?.originalReference?.file||''))throw new Error('Missing original baseline reference');
      const originalBaseline=read(o.originalReference.file);
      const inputMatches=i=>run.inputs.some(r=>r.name===i.name&&r.sha256===i.sha256)&&hash(fs.readFileSync(path.join(root,i.name)))===i.sha256;
      const referencePath=path.relative(root,path.join(packet,o.originalReference.file));
      const baselineMatches=originalBaseline.pack==='server-foundation'&&originalBaseline.exitCode===0&&originalBaseline.populationMatches===true
        &&originalBaseline.baseline===run.baseline&&originalBaseline.node===o.node&&originalBaseline.id===o.originalReference.id&&originalBaseline.node===o.originalReference.node
        &&originalBaseline.inputBase==='repository root'&&originalBaseline.inputs.every(inputMatches)
        &&inputMatches({name:referencePath,sha256:o.originalReference.sha256})
        &&['fixtures/server-foundation.json','configs/http-originals.mjs'].every(p=>run.inputs.some(i=>i.name===path.relative(root,path.join(testRoot,p))))
        &&originalBaseline.outcome.numTotalTests===64&&originalBaseline.outcome.numPassedTests===64&&originalBaseline.outcome.numFailedTests===0
        &&originalBaseline.outcome.testResults.length===4;
      const expectedOriginalPopulation=originalHttpSelection.files.map(f=>{
        const suite=originalBaseline.outcome.testResults.find(s=>s.name==='<worktree>/'+f.path),assertions=suite.assertionResults;
        if(suite.status!=='passed'||assertions.length!==f.expectedCases||assertions.some(a=>a.status!=='passed'||a.failureMessages.length)
          ||new Set(assertions.map(a=>a.fullName)).size!==f.expectedCases)throw new Error('Baseline original assertion population invalid');
        return {path:f.path,assertions:assertions.map(({fullName,title,ancestorTitles})=>({fullName,title,ancestorTitles}))};
      });
      const mutationFor={'duplicate-middleware-red':'duplicate-middleware','duplicate-error-red':'duplicate-error','duplicate-dispatcher-red':'duplicate-dispatcher','leaked-default-red':'leaked-default'};
      const originalCases=fs.readFileSync(path.join(testRoot,'cases/http-middleware.case.mjs'),'utf8');
      const expectedCaseImports=[
        {before:"'../../../../backend/src/0_system/http/middleware/index.mjs'",after:"'@daylight/platform/server/system/http/middleware'"},
        {before:"import { initializeLogging, resetLogging } from '../../../../backend/src/0_system/logging/dispatcher.mjs';",after:"import { initializeLogging } from '@daylight/platform/server/system/logging/dispatcher';\nimport { resetLogging } from '@daylight/platform/server/system/logging/testing';"},
        {before:"'../../../../backend/src/0_system/utils/errors/InfrastructureError.mjs'",after:"'@daylight/platform/server/system/utils/errors/infrastructure-error'"}
      ];
      let nativeCases=originalCases;
      for(const e of o?.caseImports||[]){if(nativeCases.split(e.before).length!==2)throw new Error('Native case import anchor mismatch');nativeCases=nativeCases.replace(e.before,e.after);}
      const originalBody=originalCases.slice(originalCases.indexOf('\nlet events;'));
      const expectedSources=expectedPlan.map(f=>({path:f.destination,sha256:f.proposedSha256}));
      const exportsFor=(prefix,targetPrefix)=>Object.fromEntries(facades.map(f=>[f[prefix].replace(prefix==='entry'?'@daylight/platform':'@daylight-internal/platform--server','.'),'./'+f[targetPrefix].replace(targetPrefix==='path'?'platform/public/':'platform/server/','')]));
      const expectedPublic=exportsFor('entry','path'),expectedPrivate=exportsFor('privateEntry','target');
      const publicManifest={name:'@daylight/platform',version:'0.0.0',private:true,type:'module',exports:expectedPublic,dependencies:{'@daylight-internal/platform--server':'0.0.0'}};
      const serverManifest={name:'@daylight-internal/platform--server',version:'0.0.0',private:true,type:'module',exports:expectedPrivate,dependencies:{uuid:h.packageFragments.server.dependencies.uuid}};
      const vendorInputs=run.toolchainInputs?.filter(i=>i.name.startsWith('backend/node_modules/uuid/')).map(i=>({name:i.name.replace('backend/node_modules/uuid/',''),sha256:i.sha256})).sort((a,b)=>a.name.localeCompare(b.name));
      httpIdentityExperimentPassed=run.exitCode===0&&o?.passed===true&&selected.length===11&&changes.length===7&&facades.length===9
        &&baselineMatches&&originalHttpSelection.files.length===4&&expectedOriginalPlan.reduce((n,f)=>n+f.edits.length,0)===5
        &&same(o.originalTestPlan,expectedOriginalPlan)&&same(o.originalPopulation,expectedOriginalPopulation)
        &&JSON.stringify(o.sourcePlan)===JSON.stringify(expectedPlan)&&JSON.stringify(o.facadeHashes)===JSON.stringify(expectedFacades)
        &&JSON.stringify(o.publicExports)===JSON.stringify(expectedPublic)&&JSON.stringify(o.privateExports)===JSON.stringify(expectedPrivate)
        &&o.originalClosure===21&&o.nativeClosure===11&&o.sourceEdges.length===16&&o.vendorFiles===190&&vendorInputs.length===190
        &&o.vendorTreeSha256===hash(JSON.stringify(vendorInputs))&&o.declaredUuidRange==='^11.1.0'
        &&JSON.stringify(o.caseImports)===JSON.stringify(expectedCaseImports)&&o.originalCaseSha256===hash(originalCases)&&o.nativeCaseSha256===hash(nativeCases)
        &&nativeCases.slice(nativeCases.indexOf('\nlet events;'))===originalBody&&o.unchangedCaseBodySha256===hash(originalBody)
        &&JSON.stringify(o.initialWrittenGraph)===JSON.stringify(o.restoredWrittenGraph)
        &&JSON.stringify(o.restoredWrittenGraph?.sourceHashes)===JSON.stringify(expectedSources)
        &&JSON.stringify(o.restoredWrittenGraph?.facadeHashes)===JSON.stringify(expectedFacades)
        &&o.restoredWrittenGraph?.publicManifestSha256===hash(JSON.stringify(publicManifest,null,2)+'\n')
        &&o.restoredWrittenGraph?.serverManifestSha256===hash(JSON.stringify(serverManifest,null,2)+'\n')
        &&o.restoredWrittenGraph?.uuidTreeSha256===o.vendorTreeSha256&&o.restoredWrittenGraph?.privatePopulation===11&&o.restoredWrittenGraph?.manualLinksCanonical===true
        &&o.restoredWrittenGraph?.vitestLinkCanonical===true&&same(o.restoredWrittenGraph?.originalTestHashes,expectedOriginalPlan.map(f=>({path:f.path,sha256:f.proposedSha256})))
        &&JSON.stringify(o.records?.map(r=>r.label))===JSON.stringify(labels)&&o.records.every(r=>{
          const mutation=mutationFor[r.label],failed=mutation?nativeHttpSelection.mutations[mutation]:[];
          if(r.exitCode!==(mutation?1:0)||r.expectedExit!==r.exitCode||r.populationMatches!==true)return false;
          if(r.kind==='originals'){
            const result=r.result,diagnostics=r.stderr.trim().split('\n');
            if(!['originals-initial','originals-final-restored'].includes(r.label)||result?.success!==true||result.numTotalTests!==64||result.numPassedTests!==64
              ||result.numFailedTests!==0||result.numPendingTests!==0||result.numTodoTests!==0||result.testResults.length!==4||r.population.length!==4
              ||diagnostics.length!==10||diagnostics.some(d=>!/^\[(?:WARN|ERROR)\] http\.error\.(?:expected|unexpected|unknown) \{.*\}$/.test(d)))return false;
            return originalHttpSelection.files.every(f=>{
              const suite=result.testResults.find(s=>s.name==='<run-root>/fixture/'+f.path),assertions=suite?.assertionResults||[];
              const population=r.population.find(p=>p.path===f.path);
              return suite?.status==='passed'&&assertions.length===f.expectedCases&&assertions.every(a=>a.status==='passed'&&a.failureMessages.length===0)
                &&same(assertions.map(({fullName,title,ancestorTitles})=>({fullName,title,ancestorTitles})),expectedOriginalPopulation.find(p=>p.path===f.path).assertions)
                &&same(population,{path:f.path,expectedCases:f.expectedCases,actualCases:f.expectedCases,passed:f.expectedCases,namesMatch:true,allPassed:true});
            });
          }
          if(r.stderr!=='')return false;
          if(r.kind==='contracts'){
            const ids=[...r.stdout.matchAll(/^ok \d+ - (CASE-\S+)/gm)].map(m=>m[1]).sort();
            return ['contracts-initial','contracts-final-restored'].includes(r.label)&&/^# tests 37$/m.test(r.stdout)&&/^# fail 0$/m.test(r.stdout)
              &&['skipped','todo','cancelled'].every(k=>new RegExp('^# '+k+' 0$','m').test(r.stdout))
              &&JSON.stringify(ids)===JSON.stringify([...httpSelection.caseIds].sort())&&JSON.stringify(r.caseIds)===JSON.stringify(ids);
          }
          const parsed=JSON.parse(r.stdout);
          return r.kind==='probe'&&r.mutation===(mutation||null)&&JSON.stringify(parsed)===JSON.stringify(r.result)
            &&parsed.count===12&&parsed.passed===!mutation&&JSON.stringify(parsed.results.map(p=>p.id))===JSON.stringify(nativeHttpSelection.probeIds)
            &&JSON.stringify(parsed.failedIds)===JSON.stringify(failed)&&JSON.stringify(parsed.results.filter(p=>!p.passed).map(p=>p.id))===JSON.stringify(failed)
            &&parsed.results.every(p=>p.passed===!failed.includes(p.id))
            &&(mutation==='duplicate-dispatcher'?parsed.fallbackDiagnostics>0:parsed.fallbackDiagnostics===0);
        });
    } catch { httpIdentityExperimentPassed=false; }
  }
  const renderingValidation=run.pack==='rendering-identity'?validateRenderingIdentity(run,root,packet,process.env.PRE_TOOLCHAIN_ROOT):null;
  let renderingConsumersPassed=null;
  if(run.pack==='rendering-consumers'){
    const specification=read('rendering-consumer-review.json'),o=run.outcome;
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    try{
      renderingConsumersPassed=run.exitCode===0&&run.signal===null&&run.stderr===''&&o.passed===true&&o.node===process.version
        &&same(o.files,specification.files)&&same(o.suites,specification.suites)&&o.sourceEdits===20
        &&o.initialGraph.files.length===125&&o.initialGraph.links.length===13&&same(o.initialGraph,o.finalGraph)
        &&specification.files.every(f=>['baseline','candidate'].every(v=>{
          const written=o.initialGraph.files.find(w=>w.path===v+'/'+(v==='baseline'?f.path:f.destination));
          return written?.mode===420&&written.sha256===(v==='baseline'?f.originalSha256:f.proposedSha256);
        }))
        &&same(o.records.map(r=>[r.variant,r.kind,r.scope]),['baseline','candidate'].flatMap(v=>[[v,'node','backend'],[v,'vitest','root'],[v,'vitest','backend']]))
        &&o.records.every(r=>{
          if(r.exitCode!==0||r.signal!==null||r.stderr!==''||!r.populationMatches)return false;
          const selected=specification.suites.filter(s=>s.runner===r.kind&&s.runtimeScope===r.scope);
          if(r.kind==='node'){
            const titles=[...r.stdout.matchAll(/^ok \d+ - ([^\n]+)$/gm)].map(m=>m[1]);
            return same(titles,selected[0].cases.map(c=>c.title))&&same(titles,r.cases)
              &&['tests 2','pass 2','fail 0','cancelled 0','skipped 0','todo 0'].every(x=>r.stdout.split('\n').includes('# '+x));
          }
          const result=r.outcome,count=selected.reduce((n,s)=>n+s.expected,0);
          return result.success&&result.numTotalTests===count&&result.numPassedTests===count
            &&['numFailedTests','numPendingTests','numTodoTests'].every(k=>result[k]===0)&&result.testResults.length===selected.length
            &&selected.every(s=>{
              const suite=result.testResults.find(t=>t.name==='<run-root>/'+r.variant+'/'+s.path);
              return suite?.status==='passed'&&suite.assertionResults.length===s.expected
                &&suite.assertionResults.every(a=>a.status==='passed'&&a.failureMessages.length===0)
                &&same(suite.assertionResults.map(({title,ancestorTitles,fullName})=>({title,ancestorTitles,fullName})),s.cases);
            });
        });
    }catch{renderingConsumersPassed=false;}
  }
  return {
    file: 'evidence/' + file,
    artifactId: 'EVIDENCE-' + file,
    logicalRunId: run.id,
    pack: run.pack || 'vitest-' + run.mode,
    capturedAt: run.capturedAt,
    fresh,
    exitCode: run.exitCode,
    setupFailure: run.setupFailure || null,
    populationMatches: run.pack==='http-middleware'?httpPopulationMatches:['daylight.preimplementation.vitest-run/v1','daylight.preimplementation.fileio-consumers/v1','daylight.preimplementation.server-foundation/v1'].includes(run.schema)?run.populationMatches:null,
    mutation: run.mutation || null,
    mutationDetected: run.pack==='http-middleware'?httpMutationDetected===true:run.mutationDetected || false,
    passed: run.passed?.length ?? run.outcome?.numPassedTests ?? null,
    failed: run.failed?.length ?? run.outcome?.numFailedTests ?? null,
    fileioExperimentPassed, loggingExperimentPassed, httpIdentityExperimentPassed,
    renderingExperimentPassed: renderingValidation?.passed ?? null,
    renderingValidationError: renderingValidation?.error ?? null,
    renderingConsumersPassed,
    discoveredFiles: Array.isArray(run.outcome) ? run.outcome.length : run.fileCount ?? null,
    packageExperimentPassed: run.pack==='package-install' ? run.outcome?.passed===true && run.outcome.records?.length===10 && run.outcome.records.every(r=>r.exitCode===r.expectedExit&&r.expectedDiagnostic) : null
  };
}).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
const latest = {};
for (const run of historical) if (run.fresh && !run.mutation && run.target !== 'candidate') latest[run.pack] = run;
const expected = {
  isolation: 8,
  gratitude: 59,
  rendering: 9,
  browser: 25,
  architecture: 18,
  packages: 7,
  registrations: 78,
  'vitest-stored-shape': 6,
  'vitest-print-gateway': 1,
  'fileio-consumers': 36,
  'server-foundation': 64,
  'http-middleware': 37
};
for (const [pack, count] of Object.entries(expected)) {
  const receipt = latest[pack];
  if (receipt?.setupFailure?.state === 'host-denied') problems.push('required baseline execution unavailable: ' + pack + ' (macOS sandbox host-denied)');
  else if (!receipt || receipt.exitCode !== 0 || receipt.passed !== count || receipt.failed !== 0 || receipt.populationMatches===false) problems.push('current required baseline evidence not green: ' + pack);
}
if (latest['vitest-discover']?.discoveredFiles !== 3826) problems.push('dedicated discovery population mismatch');
if (latest['vitest-default-discover']?.discoveredFiles !== 3886) problems.push('current Vitest policy discovery population mismatch');
if (!latest['package-install']?.packageExperimentPassed) problems.push('fresh package install/reinstall/red-restored experiment missing');
if (!latest['fileio-identity']?.fileioExperimentPassed) problems.push('fresh FileIO identity/mock counterexample experiment missing; explicit PRE_TOOLCHAIN_ROOT is required');
if (!latest['fileio-identity-selected']?.fileioExperimentPassed) problems.push('fresh selected 73-name FileIO package fixture proof missing');
if (!latest['logging-identity']?.loggingExperimentPassed) problems.push('fresh selected logging native identity/lifecycle fixture proof missing');
if (!latest['http-identity']?.httpIdentityExperimentPassed) problems.push('fresh selected HTTP native closure/identity/37-case fixture proof missing');
if (!latest['rendering-identity']?.renderingExperimentPassed) problems.push('fresh rendering/font native and original-suite fixture proof missing');
if (!latest['rendering-consumers']?.renderingConsumersPassed) problems.push('fresh original rendering consumer before/after evidence missing');
const renderingValidationControls=[];
if(latest['rendering-identity']?.renderingExperimentPassed){
  const original=read(latest['rendering-identity'].file);
  const controls=[
    ['missing-native-input',r=>r.toolchainInputs.pop()],
    ['changed-original-body-hash',r=>{r.outcome.originalTestPlan[0].unchangedBodySha256='0'.repeat(64);}],
    ['wrong-written-font',r=>{for(const graph of [r.outcome.initialGraph,r.outcome.restoredGraph])graph.files.find(f=>f.path==='candidate/platform/server/assets/fonts/kongtext/kongtext.ttf').sha256='0'.repeat(64);}],
    ['missing-probe',r=>{const step=r.outcome.records[0];step.result.results.pop();step.result.count--;step.stdout=JSON.stringify(step.result)+'\n';}],
    ['renamed-original-assertion',r=>{r.outcome.records.find(s=>s.label==='candidate-originals').result.testResults[0].assertionResults[0].title='substituted assertion';}],
    ['changed-candidate-font-metric',r=>{const step=r.outcome.records.find(s=>s.label==='candidate-native');step.result.results.find(p=>p.id==='REND-DRAWING').observation.metrics[0].width++;step.stdout=JSON.stringify(step.result)+'\n';}],
  ];
  for(const [id,mutate] of controls){
    const changed=structuredClone(original);mutate(changed);
    const result=validateRenderingIdentity(changed,root,packet,process.env.PRE_TOOLCHAIN_ROOT);
    renderingValidationControls.push({id,rejected:!result.passed});
    if(result.passed)problems.push('rendering receipt validator accepted defect: '+id);
  }
}
const pairs = [];
for (const mutation of ['missing-mount', 'changed-response', 'changed-storage', 'failed-print-marks', 'duplicate-event', 'missing-cleanup', 'missing-asset', ...Object.keys(httpSelection.mutations)]) {
  const red = historical.filter(r => r.fresh && r.mutation === mutation && r.mutationDetected).at(-1);
  const green = red ? latest[red.pack] : null;
  const restored = red && green && green.exitCode === 0 && green.capturedAt > red.capturedAt;
  if (!restored) problems.push('red/restored pair missing: ' + mutation);
  pairs.push({
    mutation,
    red: red?.file || null,
    restoredGreen: restored ? green.file : null,
    status: restored ? 'observed' : 'not-proved'
  });
}
const ids = new Set(status.items.map(i => i.id));
if (ids.size !== 134 || status.items.length !== 134) problems.push('PRE ID population mismatch');
const reviewedById = new Map((reviewedExits.items || []).map(item => [item.id, item]));
if (reviewedById.size !== ids.size) problems.push('reviewed-exit ID population mismatch');
for (const item of status.items) {
  const reviewed = reviewedById.get(item.id);
  if (!reviewed || reviewed.status !== item.status || !Array.isArray(reviewed.evidence) || !reviewed.evidence.length || !reviewed.review)
    problems.push('missing or inconsistent reviewed exit: ' + item.id);
  if (item.status === 'complete' && reviewed?.blockers?.length) problems.push('complete item retains blockers: ' + item.id);
}
const plan = fs.readFileSync(path.join(root, 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md'), 'utf8');
for (const item of status.items) {
  const match = plan.match(new RegExp('^- \\[([ x])\\] \\*\\*' + item.id.replaceAll('.', '\\.') + ' —', 'm'));
  if (!match || match[1] === 'x' !== (item.status === 'complete')) problems.push('checkbox mismatch: ' + item.id);
  for (const dep of item.prerequisiteIds) if (!ids.has(dep)) problems.push('unknown prerequisite: ' + dep);
  for (const evidence of item.evidenceIds) if (!fs.existsSync(path.resolve(packet, evidence.split('#')[0]))) problems.push('missing task evidence: ' + evidence);
}
const visiting = new Set(),
  visited = new Set(),
  byId = new Map(status.items.map(i => [i.id, i]));
function visit(id) {
  if (visiting.has(id)) {
    problems.push('PRE cycle: ' + id);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dep of byId.get(id)?.prerequisiteIds || []) visit(dep);
  visiting.delete(id);
  visited.add(id);
}
for (const id of ids) visit(id);
const gitStatus = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: root,
  encoding: 'utf8'
}).trimEnd().split('\n').filter(Boolean);
const allowed = name => name === 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md' || name.startsWith('docs/_wip/audits/2026-09-05-application-module-preimplementation/') || name.startsWith('tests/preimplementation/application-modules/');
for (const line of gitStatus) if (!allowed(line.slice(3))) problems.push('outside allowed output: ' + line.slice(3));
const counts = {};
for (const item of status.items) counts[item.status] = (counts[item.status] || 0) + 1;
emit('evidence-index.json', {
  schema: 'daylight.preimplementation.evidence-index/v1',
  baseline: baseline.revision,
  capturedAt: new Date().toISOString(),
  latest,
  redRestoredPairs: pairs,
  renderingValidationControls,
  history: historical,
  limits: ['Historical logical run IDs may repeat; artifactId/file is the unique evidence identity', 'Only fresh hashes plus actual outcomes qualify for current claims', 'Architecture observation/prototype passes do not mean current enforcement meets requirements', 'Native manual-link package fixture is not npm adoption proof']
});
emit('packet-audit.json', {
  schema: 'daylight.preimplementation.packet-audit/v1',
  baseline: baseline.revision,
  capturedAt: new Date().toISOString(),
  protectedFiles: source.files.filter(f => f.protected).length,
  trackedFiles: source.total,
  taskCounts: counts,
  currentSelectedAssertions: Object.values(expected).reduce((a, b) => a + b, 0),
  dedicatedDiscoveredFiles: latest['vitest-discover']?.discoveredFiles,
  redRestoredPairs: pairs.filter(p => p.status === 'observed').length,
  checks: ['protected source bytes/executable bits/symlinks', 'tracked population', 'allowed Git changes', 'fresh selected test outcomes and exact counts', 'eleven named red/restored pairs, including exact HTTP case sets', 'derived API/browser/boundary/lifecycle/storage/resource/wire source/tool/inventory hashes and identities', 'PRE unique IDs/prerequisite DAG/evidence files/checkbox consistency', 'every PRE status has a matching reviewed exit with evidence/review and no retained blocker on a complete item'],
  problems,
  limits: ['Not complete semantic traceability, ownership approval, whole-runner audit or production readiness', 'Open PRE exits remain open even when this packet integrity check passes']
});
process.stdout.write(JSON.stringify({
  problems,
  taskCounts: counts,
  protectedFiles: source.files.filter(f => f.protected).length,
  currentSelectedAssertions: Object.values(expected).reduce((a, b) => a + b, 0),
  redRestoredPairs: pairs.filter(p => p.status === 'observed').length
}) + '\n');
if (problems.length) process.exitCode = 1;
