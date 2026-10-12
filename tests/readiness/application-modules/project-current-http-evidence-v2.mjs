import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename));
const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../../..');
const parser = createRequire(path.join(repo, 'package.json'))('@babel/parser');
const state = '/home/ds/.local/state/daylight-readiness/cutover-2026-10-11';
const stage = '/tmp/readiness-final640-bf-native-01';
const graphRoot = '/tmp/readiness-final-graph-prod-predicate-b1c-v4/execution';
const pins = {};
function bound(filename) { pins[filename] = sha(fs.readFileSync(filename)); return read(filename); }
function joined(prefix, local) {
  assert(typeof prefix === 'string' && typeof local === 'string');
  return ('/' + [prefix, local].map(x => x.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'));
}
function projectGraph(graph) {
  assert.equal(graph.errors.length, 0);
  assert.equal(graph.orderedEvents.length, graph.eventCount);
  const events = graph.orderedEvents;
  assert(new Set(events.map(x => x.order)).size === events.length);
  const reachable = [], opaque = [], reachedRouters = new Set();
  function visit(routerId, prefix, ancestors = [], mountOrders = []) {
    assert(!ancestors.includes(routerId), 'cyclic router mount');
    assert(ancestors.length < 32 && reachable.length < 20000, 'graph cap');
    reachedRouters.add(routerId);
    for (const e of events.filter(x => x.routerId === routerId)) {
      assert(typeof e.path === 'string' && e.path.startsWith('/'), 'unsupported native path');
      if (e.kind === 'route') {
        for (const method of e.methods) reachable.push({ order: e.order, routerId,
          localPath: e.path, method, template: joined(prefix, e.path), mountOrders,
          handlerSha256: e.handlers.filter(h => h.method === method).map(h => h.handler.sourceSha256) });
      } else if (e.childRouterId != null) {
        assert(events.some(x => x.routerId === e.childRouterId), 'missing child router');
        visit(e.childRouterId, joined(prefix, e.path), [...ancestors, routerId], [...mountOrders, e.order]);
      } else opaque.push({ order: e.order, routerId, template: joined(prefix, e.path),
        name: e.handler.name, role: e.role, handlerSha256: e.handler.sourceSha256,
        disposition: 'middleware-or-opaque-delegate; no nested route inference' });
    }
  }
  visit(1, '/');
  return { reachable, opaque, detached: events.filter(x => x.kind === 'route' && !reachedRouters.has(x.routerId)),
    reachedRouterIds: [...reachedRouters].sort((a,b) => a-b) };
}
function matches(template, request) {
  if (/[()*]/.test(template)) return false; // Complex patterns remain unresolved.
  const expression = template.split('/').map(s => s.startsWith(':') ? '[^/]+' : s.replace(/[.+?^${}|[\]\\]/g, '\\$&')).join('/');
  return new RegExp('^' + expression + '/?$').test(request.split('?')[0]);
}
function controls() {
  const handler = { name:'h', sourceSha256:'x' };
  const use = {order:0,routerId:1,kind:'use',path:'/api',childRouterId:2,handler};
  const route = {order:1,routerId:2,kind:'route',path:'/x/:id',methods:['get','post'],handlers:[{method:'get',handler},{method:'post',handler}]};
  const graph = {errors:[],eventCount:2,orderedEvents:[use,route]};
  assert.deepEqual(projectGraph(graph).reachable.map(x => x.template), ['/api/x/:id','/api/x/:id']);
  assert.equal(joined('/','/'),'/');
  assert(matches('/api/x/:id','/api/x/abc?q=1')); assert(!matches('/api/x/:id','/api/x/a/b'));
  assert(!matches('/x/*','/x/y'));
  for (const bad of [ {...graph,eventCount:3}, {...graph,errors:['error']},
    {...graph,orderedEvents:[use,{...route,order:0}]},
    {...graph,orderedEvents:[use,{...use,order:1,routerId:2,childRouterId:1}]},
    {...graph,orderedEvents:[{...use,childRouterId:99},route]} ]) assert.throws(() => projectGraph(bad));
  console.log(JSON.stringify({positive:3,negative:7,scope:'pure task graph traversal and finite template matching'}));
}
if (process.argv.includes('--controls')) { controls(); process.exit(); }
const census = bound(path.join(here, 'current-http-source-census.json'));
const facts = bound(path.join(here, 'http-reviewed-effect-facts.json'));
const finalReview = bound(path.join(state, 'final640-bf-actual-review-v1.json'));
assert.equal(finalReview.accounting.uniqueAdmittedIds, 640);
const config = bound(path.join(stage, 'FINAL640-CONFIG.json'));
const predicateAudit = bound('/tmp/readiness-current-2217-route-denominator-v2/CONDITIONAL-REGISTRATION-AUDIT-v2.json');
const deviceDelegateProjection = bound('/tmp/readiness-current-2217-route-denominator-v2/DEVICE-PROXY-ELIGIBLE-PROJECTION.json');
const relocatedMountReview = bound(path.join(state,'current-http-eleven-mount-relocation-v1.json'));
assert.equal(pins[path.join(stage,'FINAL640-CONFIG.json')], finalReview.pins.config);
const finalSupplement = bound(path.join(stage,'FINAL640-SUPPLEMENTED.json'));
assert.equal(pins[path.join(stage,'FINAL640-SUPPLEMENTED.json')], finalReview.pins.supplementedAccounting);
assert.equal(finalSupplement.accepted,true);
const cases = [];
for (const lane of config.lanes) {
  const admissionPath = lane.kind === 'png1' ? path.join(lane.root,'bound-manifest.json') : lane.admission;
  const admission = bound(admissionPath);
  const selected = admission.cases ?? admission.clusters.flatMap(c => c.groups ? c.groups.flatMap(g => g.cases) : c.cases);
  for (const c of selected) cases.push({id:c.id,method:c.method.toLowerCase(),path:c.path,
    lane:lane.name,admissionPath,expectedStatus:c.expected?.status,
    evidenceDisposition: lane.kind === 'metadata' ? 'accepted metadata-only contract; media payload not verified' : 'accepted finite API contract; exact fixture/query only',
    reviewPath:path.join(state,'final640-bf-actual-review-v1.json')});
}
assert.equal(cases.length,640); assert.equal(new Set(cases.map(x=>x.id)).size,640);
const laterScopedContracts=[];
const laterPackets=[
  ['static3-default-native-actual-review-v2.json','/tmp/readiness-static23-default-three-b1c-v1/execution/RESULT.json','default-only'],
  ['static23-next-two-actual-review-v1.json','/tmp/readiness-static23-next-two-b1c-v1/execution/RESULT.json','default-only'],
  ['cost-budget-unavailable-actual-review-v1.json','/tmp/readiness-static23-cost-budgets-b1c-v1/execution/RESULT.json','configured-unavailable; parity-only'],
  ['arcade-health-clock-actual-review-v1.json','/tmp/readiness-static23-arcade-health-b1c-v1/execution/RESULT.json','started empty-device monitor; no active hardware'],
  ['baseline-five-error-default-actual-review-v1.json','/tmp/readiness-current-baseline-errors-b1c-v1/execution/RESULT.json','source baseline errors/unwired/default; healthyFeatureCredit=false'],
  ['ROOT-CURRENT-STATUS-ACTUAL-REVIEW-V1.json','/tmp/readiness-current-status-b1c-v1/execution/RESULT.json','configured synthetic status; production denominator unproven'],
];
for(const [receipt,resultFile,scope] of laterPackets) {
  const review=bound(path.join(state,receipt)),result=bound(resultFile);
  const expected=review.resultSha256 ?? review.pins?.[resultFile];
  assert.equal(pins[resultFile],expected ?? review.pins?.[resultFile]);
  const rows=Array.isArray(result.roles)?result.roles:Object.values(result.roles);
  const rawFile=path.join(path.dirname(resultFile),'reference-responses.private.json');
  const raw=bound(rawFile);
  assert.equal(pins[rawFile],rows[0].rawResponseSha256 ?? rows[0].rawResponsesSha256);
  for(const [index,c] of (rows[0].contracts ?? []).entries())laterScopedContracts.push({id:c.id??null,method:'get',path:raw[index].path,
    scope,reviewPath:path.join(state,receipt),resultPath:resultFile,
    evidenceDisposition:'accepted exact scoped contract, not whole-template healthy closure'});
  if(receipt.startsWith('ROOT-CURRENT-STATUS') && !laterScopedContracts.some(x=>x.reviewPath===path.join(state,receipt)))laterScopedContracts.push({id:null,method:'get',path:'/api/v1/status',scope,
    reviewPath:path.join(state,receipt),resultPath:resultFile,evidenceDisposition:'accepted configured synthetic branch'});
}
const fileCache = new Map();
function source(commit,file) {
  const key = commit+':'+file;
  if(!fileCache.has(key)) fileCache.set(key,execFileSync('git',['show',key],{cwd:repo,maxBuffer:16*1024*1024}));
  return fileCache.get(key);
}
const candidate = census.roles.find(x=>x.role==='candidate');
const proofPins = Object.entries(facts.sourceSha256).map(([file,expected]) => {
  let actual=null;try { actual=sha(source(candidate.commit,file)); } catch {}
  return {file,expected,actual,exact:actual===expected};
});
const pinMap = new Map(proofPins.map(x=>[x.file,x]));
const spanProof=bound(path.join(state,'current-eight-helper-proof-spans-v2.json'));
assert.equal(pins[path.join(state,'current-eight-helper-proof-spans-v2.json')],'835b4b1ac1ec8446f34aa5038e2c874c10466cf5cea18e354dc64595eb25dcd5');
const spanApproval=bound(path.join(state,'ROOT-EIGHT-HELPER-NAMED-PROOF-REVIEW-V2.json'));
assert.equal(pins[path.join(state,'ROOT-EIGHT-HELPER-NAMED-PROOF-REVIEW-V2.json')],'8162033f692460670dcacd96cc42669f6a0feab4c7d17640bcb7b52ef10d3ddb');
assert.equal(spanProof.currentSource,candidate.commit);
const changedProofs=new Map(spanProof.rows.map(row=>{
 assert.equal(pinMap.get(row.file).expected,row.oldSha256);
 assert.equal(pinMap.get(row.file).actual,row.currentSha256);
 return [row.file,row];
}));
const finiteCandidates=new Set(spanProof.affectedFacts.filter(x=>x.classification==='finite-safe'&&x.allNumberedChangedProofSpansExact).map(x=>x.declarationId));
assert.equal(finiteCandidates.size,160);
function qualifiedReference(ref) {
 const file=ref.split(':')[0];
 if(pinMap.get(file)?.exact)return {reference:ref,qualification:'exact whole-file historical pin'};
 const row=changedProofs.get(file),proof=row?.namedProofSpans.find(x=>x.reference===ref);
 return proof?.qualified ? {reference:ref,qualification:'root-reviewed exact executable named span',baselineCommit:row.expectedPinBaselineCommit,baselineFileSha256:row.oldSha256,currentFileSha256:row.currentSha256,spanSha256:proof.spanSha256,currentLines:proof.currentLines} : null;
}

const fnCache = new Map();
function functions(commit,file) {
  const key=commit+':'+file;if(fnCache.has(key))return fnCache.get(key);
  const code=source(commit,file).toString();
  const tree=parser.parse(code,{sourceType:'unambiguous',plugins:['jsx','typescript','decorators-legacy'],errorRecovery:false});
  const rows=[];
  function walk(n) { if(!n||typeof n!=='object')return;
    if(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(n.type)) {
      const text=code.slice(n.start,n.end);rows.push({text,sha256:sha(text)});
    }
    for(const [key,v] of Object.entries(n))if(!['loc','tokens','comments'].includes(key)) {
      if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);
    }
  }
  walk(tree);fnCache.set(key,rows);return rows;
}
const roles=[];
for(const role of census.roles) {
  assert.equal(role.commit,role.role==='reference'?finalReview.pair.referenceSource:finalReview.pair.candidateSource);
  const graph=bound(path.join(graphRoot,role.role+'-ordered-graph.private.json'));
  assert.equal(pins[path.join(graphRoot,role.role+'-ordered-graph.private.json')],'98684bab4c8d6317f48dcfa155768aa38fb42c378f4bbdb73fc1dc7e76d79cc4');
  const projection=projectGraph(graph);
  const declarations=role.sites.map(site=>{
    assert.equal(sha(source(role.commit,site.file)),site.sourceSha256,'current declaration source pin');
    const local=graph.orderedEvents.filter(e=>e.kind==='route' && e.methods.includes(site.method) && site.literalPaths.includes(e.path));
    const functionHashes = site.classification==='route-declaration' && site.handlers.length
      ? functions(role.commit,site.file).filter(f=>site.handlers.some(h=>h.length && f.text.startsWith(h))).map(f=>f.sha256) : [];
    const exact=local.filter(e=>e.handlers.some(h=>h.method===site.method && functionHashes.includes(h.handler.sourceSha256)));
    const mounted=projection.reachable.filter(e=>exact.some(x=>x.order===e.order)&&e.method===site.method);
    const fact=facts.facts.find(x=>x.declarationId===site.declarationId);
    const named=fact?.sourceProof.map(x=>x.split(':')[0]) ?? [];
    const evidenceExact=role.role==='candidate' && fact && named.length && pinMap.get(site.file)?.exact && named.every(f=>pinMap.get(f)?.exact);
    const namedQualifications=fact?.sourceProof.map(qualifiedReference)??[];
    const primaryChanged=changedProofs.get(site.file);
    const baselineCallbackHashes=primaryChanged ? functions(primaryChanged.expectedPinBaselineCommit,site.file).map(x=>x.sha256) : [];
    const primaryHandlerExact=pinMap.get(site.file)?.exact || (functionHashes.length>0 && functionHashes.every(h=>baselineCallbackHashes.includes(h)));
    const qualifiedFiniteRenewal=role.role==='candidate' && finiteCandidates.has(site.declarationId) && fact?.classification==='finite-safe'
      && primaryHandlerExact && namedQualifications.length>0 && namedQualifications.every(Boolean);
    const localPolicy=evidenceExact ? fact.classification : qualifiedFiniteRenewal ? 'finite-safe' : 'current-transitive-effect-review-required';
    const linked=[...cases,...laterScopedContracts].filter(c=>mounted.some(e=>e.method===c.method&&matches(e.template,c.path)));
    return { declarationId:site.declarationId,file:site.file,line:site.line,owner:site.owner,
      method:site.method,pathExpression:site.pathExpression,literalPaths:site.literalPaths,predicates:site.guards,
      sourceSha256:site.sourceSha256,classification:site.classification,
      taskJoin:{localPathMethodCandidateOrders:local.map(x=>x.order),exactInlineHandlerOrders:exact.map(x=>x.order),
        mountedTemplates:mounted.map(x=>({template:x.template,order:x.order,mountOrders:x.mountOrders})),
        disposition:exact.length ? (mounted.length?'exact handler/path/method observed in task mount graph':'exact handler observed but detached in task graph') : 'unresolved: no exact inline handler/path/method binding; absence not inferred'},
      localEffectPolicy:localPolicy, qualifiedFiniteRenewal:Boolean(qualifiedFiniteRenewal), primaryHandlerExactToExpectedPinBaseline:Boolean(primaryHandlerExact), namedSourceProofQualifications:namedQualifications, effectEvidenceNamedPins:named.map(f=>pinMap.get(f)??{file:f,exact:false}),
      historicalIdentityLink:site.historicalLink,
      currentApiEvidence:linked.map(({id,path,lane,evidenceDisposition,expectedStatus,scope,reviewPath})=>({id,path,lane,evidenceDisposition,expectedStatus,scope,reviewPath})),
      finiteReadTaskCandidates:site.method==='get' && localPolicy==='finite-safe' && mounted.length>0,
      productionReachability:'unproven; task predicates and source guards do not certify live activation',
      healthyProductionCredit:false };
  });
  const taskReachable=projection.reachable.map(e=>({...e,currentApiEvidence:[...cases,...laterScopedContracts].filter(c=>c.method===e.method&&matches(e.template,c.path))}));
  const gaps=taskReachable.filter(x=>x.method==='get' && !x.currentApiEvidence.length).map(x=>({template:x.template,order:x.order,
    sourceExactDeclarationIds:declarations.filter(d=>d.taskJoin.exactInlineHandlerOrders.includes(x.order)&&d.method==='get').map(d=>d.declarationId),
    sourceLocalPathCandidates:declarations.filter(d=>d.method==='get'&&d.literalPaths.includes(x.localPath)).map(d=>d.declarationId),
    disposition:'no accepted current API request branch linked; task-only template, production/effects unresolved'}));
  roles.push({role:role.role,commit:role.commit,graphCounts:{routeObjects:graph.routeCount,orderedEvents:graph.eventCount,
    methodEntries:graph.orderedEvents.filter(e=>e.kind==='route').reduce((n,e)=>n+e.methods.length,0),
    sourceLiteralMethodDeclarations:role.counts.localLiteralRouteDeclarations},
    taskReachable,taskUncoveredGetTemplates:gaps,
    opaqueTaskMiddleware:projection.opaque,detachedTaskRoutes:projection.detached,
    finiteSafeSourceGetDeclarations:declarations.filter(x=>x.method==='get'&&x.localEffectPolicy==='finite-safe').map(x=>x.declarationId),
    unresolvedSourceGetDeclarations:declarations.filter(x=>x.method==='get'&&x.localEffectPolicy==='current-transitive-effect-review-required').map(x=>x.declarationId),
    declarations,counts:{sites:declarations.length,exactInlineJoined:declarations.filter(x=>x.taskJoin.exactInlineHandlerOrders.length).length,
      finiteReadTaskCandidates:declarations.filter(x=>x.finiteReadTaskCandidates).length,
      currentEvidenceLinked:declarations.filter(x=>x.currentApiEvidence.length).length}});
}
const result={schema:'daylight.current-http-task-source-evidence-disposition/v2',productionMethodTemplateDenominator:null,
  scope:'Every current census site receives a source/task/effect/evidence disposition. Exact inline handler hashes qualify task joins; unresolved named/wrapped/dynamic handlers remain explicit. This is not a complete semantic router analysis, live production denominator, or authorization for HTTP.',
  limitations:['1190 source literal method declarations are not1192 native Route objects; native methods/multiplicity/detached routers/extensions are retained separately.',
    'Local finite-safe reuse requires exact named historical pins or explicitly root-reviewed unchanged named executable spans on one of160 preclassified finite-safe facts, plus exact primary handler bytes; all other helper pins remain exact. Conditional/effectful/provider facts are never upgraded. Mount/configuration/live activation remain unproved; no request permission.',
    'Historical identity/test links remain historical; current640 evidence links are exact request branches only, not all parameters or healthy feature completion.',
    'Reference transitive policy is not silently inherited from candidate facts. Opaque wrapped device/external delegates and non-JS protocols remain unresolved.',
    'Graphs are isolated synthetic task configuration. Source conditional predicates remain recorded; production reachable universe is not claimed.'],
  configurationAndBoundaryEvidence:{predicateAudit,deviceDelegateProjection,relocatedMountReview},
  qualifiedNamedSourceRenewal:{spanProofSha256:pins[path.join(state,'current-eight-helper-proof-spans-v2.json')],rootApprovalSha256:pins[path.join(state,'ROOT-EIGHT-HELPER-NAMED-PROOF-REVIEW-V2.json')],eligibleFiniteSafeFacts:160,acceptedRenewals:roles.find(x=>x.role==='candidate').declarations.filter(x=>x.qualifiedFiniteRenewal).map(x=>x.declarationId)},namedEffectPins:proofPins,current640Cases:cases,laterScopedContracts,roles,pins,generatorSha256:sha(fs.readFileSync(new URL(import.meta.url)))};
const candidateProjection=roles.find(x=>x.role==='candidate');
const linkedCaseIds=new Set(candidateProjection.taskReachable.flatMap(x=>x.currentApiEvidence.map(c=>c.id)));
result.acceptedRequestsWithUnresolvedGraphJoin=cases.filter(c=>!linkedCaseIds.has(c.id)).map(c=>({...c,
  mappingDisposition:c.path==='/healthz'?'custom Node edge, outside Express Route.stack inventory':
    c.path.startsWith('/api/v1/device')?'opaque device wrapper; separate detached source projection retained, no double-count':
      'wildcard/regex/manual/helper dispatch unresolved by this finite matcher',
  nativeContractStillAccepted:true,productionReachabilityUnproved:true}));
const nonHttp=bound(path.join(here,'non-http-surface-census.json'));
assert.equal(nonHttp.sourceCommit,candidate.commit);
const nonHttpAssociations=[
  {file:'backend/src/1_adapters/eventbus/WebSocketEventBus.mjs',review:'current-ws-minimal-actual-review-v1.json',
    scope:'related current task WS connect/subscribe ACK/transport heartbeat/server ping/clean-close observation only'},
  ...['backend/src/3_applications/scheduling/SchedulerOrchestrator.mjs','backend/src/5_composition/modules/applicationScheduledJobs.mjs',
    'modules/lifelog/server/application/archive/ArchiveService.mjs','modules/lifelog/server/composition/archive.mjs'].map(file=>({file,
      review:'current-archive-producer-actual-review-v1.json',scope:'related actual disabled synthetic archive job manual run/restart; no scheduled activation'})),
  {file:'modules/media/browser/house/ScreenAdminView.jsx',review:'current-media-screens-browser-actual-review-v2.json',
    scope:'related actual current populated catalog/visible Admin row only'},
  {file:'modules/gratitude/browser/Gratitude.jsx',review:'current-gratitude-browser-actual-review-v2.json',
    scope:'related actual current populated long row/header/date-group DOM observation only'},
];
for(const association of nonHttpAssociations) {
  bound(path.join(state,association.review));
  const file=nonHttp.files.find(x=>x.path===association.file);assert(file);
  assert.equal(sha(source(candidate.commit,association.file)),file.sha256);
  association.sourceSha256=file.sha256;association.reviewPath=path.join(state,association.review);
}
result.nonHttpSurfaceDispositions=nonHttp.files.flatMap(file=>file.sites.map((site,index)=>({
  file:file.path,sourceSha256:file.sha256,siteIndex:index,line:site.line,symbol:site.symbol,kind:site.kind,
  nameKind:site.nameKind,conditional:site.conditional,unresolved:site.unresolved,protocolBoundary:file.protocolBoundary,
  relatedCurrentEvidence:nonHttpAssociations.filter(x=>x.file===file.path),
  siteActivationCredit:false,
  disposition:file.protocolBoundary?'unverified hardware/non-JS protocol boundary':
    'source site inventoried; any related journey is scoped and does not prove this individual registration executed'
})));
assert.equal(result.nonHttpSurfaceDispositions.length,nonHttp.siteCount);
result.nonHttpRuntimeCompletion=false;
result.generatorSha256=sha(fs.readFileSync(new URL(import.meta.url)));
fs.writeFileSync(path.join(here,'current-http-evidence-projection-v2.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({roles:roles.map(r=>({role:r.role,counts:r.counts,graph:r.graphCounts})),currentCases:cases.length,
  exactNamedEffectPins:proofPins.filter(x=>x.exact).length,totalNamedEffectPins:proofPins.length,productionMethodTemplateDenominator:null}));
