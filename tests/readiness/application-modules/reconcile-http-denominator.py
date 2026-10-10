import json,hashlib,collections,os
import argparse, pathlib, re
def conditional_request_admitted(records, case_id, method, request_path, fixture_sha256, manifest_sha256):
 """Only an exact reviewed request and its same approved fixture/manifest pair."""
 return any(any(c == {'id':case_id,'method':method,'path':request_path} for c in record['requestCases']) and any(p == {'fixtureSha256':fixture_sha256,'manifestSha256':manifest_sha256} for p in record['approvedPackets']) for record in records)

def reconcile_conditional_reads(facts, eligibility, matrix, current_by_id):
 """Derive case-scoped eligibility without changing any broad handler disposition."""
 records=facts.get('conditionalReadAdmissions',[])
 assert isinstance(records,list), 'Conditional admissions must be explicit reviewed records'
 assert eligibility.get('conditionalReadAdmissions',[]) == records == matrix.get('conditionalReadAdmissions',[]), 'Conditional admission registries drifted'
 eligible_by_id={d['declarationId']:d for d in eligibility['declarations']}
 mounts={d['declarationId']:d for d in matrix['declarations']}
 assert set(eligible_by_id)==set(mounts)==set(current_by_id), 'Conditional admission declaration closure differs'
 broad={d['declarationId'] for d in eligibility['declarations'] if d['effectEligibility'] in ['eligible-finite-read','eligible-benign-process-effects','eligible-finite-existing-file-stream']}
 handler_templates={t for d in matrix['declarations'] if d['declarationId'] in broad and d['status'].startswith('expected-bound') for t in d['urlTemplates']}
 handler_conditional={t for d in matrix['declarations'] if d['declarationId'] in broad and d['status']=='expected-bound-conditional-construction' for t in d['urlTemplates']}
 ids=set();conditional_templates=set();admitted_templates=set();request_ids=set();conditional_construction=set()
 valid_hash=lambda h:isinstance(h,str) and re.fullmatch('[a-f0-9]{64}',h) is not None
 for record in records:
  admission_id=record['admissionId'];assert isinstance(admission_id,str) and admission_id and admission_id not in ids, 'Duplicate/invalid conditional admission';ids.add(admission_id)
  declaration=record['declarationId'];assert declaration in current_by_id, 'Unknown conditional declaration'
  d=eligible_by_id[declaration];mount=mounts[declaration];template=record['urlTemplate']
  assert current_by_id[declaration]['method']=='get', 'Only explicit GET declarations can receive case-scoped admission'
  assert d['effectEligibility'].startswith('blocked-'), 'Conditional admission must preserve blocked broad handler classification'
  assert mount['status'].startswith('expected-bound') and template in mount['urlTemplates'], 'Conditional template has no reviewed expected mount'
  assert template not in admitted_templates, 'Duplicate conditional template cannot inflate conditional denominator'
  admitted_templates.add(template)
  if template in handler_templates:
   assert record.get('denominatorContribution')=='none-existing-template', 'Existing eligible URL requires explicit no-denominator-growth branch scope'
  else:
   assert record.get('denominatorContribution','new-template')=='new-template', 'New eligible URL must contribute exactly once'
   conditional_templates.add(template)
   if mount['status']=='expected-bound-conditional-construction':conditional_construction.add(template)
  assert record['effectEligibility']=='eligible-finite-read-under-explicit-case-conditions' and record['noProductionAuthorization'] is True, 'Case-scoped admission is not production authorization'
  assert isinstance(record['safetyPrerequisites'],str) and record['safetyPrerequisites'].strip(), 'Explicit query/config prerequisites required'
  assert isinstance(record['scope'],str) and record['scope'].strip(), 'Explicit restricted scope required'
  assert isinstance(record['diagnosticOnly'],bool), 'Diagnostic scope must remain explicit'
  assert record['sourceProof'] and all(isinstance(p,str) and p.split(':',1)[0] in facts['sourceSha256'] for p in record['sourceProof']), 'Conditional source proof must bind existing verified dependency hashes'
  review=record['independentReview'];assert isinstance(review['path'],str) and review['path'] and valid_hash(review['sha256']), 'Independent review evidence required'
  assert valid_hash(record['sourceGuardSha256']), 'Selected source guard identity required'
  packets=record['approvedPackets'];assert isinstance(packets,list) and packets, 'Exact approved fixture/manifest pairs required'
  assert all(set(p)=={'fixtureSha256','manifestSha256'} and all(valid_hash(v) for v in p.values()) for p in packets), 'Invalid paired fixture/manifest hash'
  assert len({(p['fixtureSha256'],p['manifestSha256']) for p in packets})==len(packets), 'Duplicate approved packet'
  assert record['approvedFixtureSha256']==[p['fixtureSha256'] for p in packets] and record['approvedManifestSha256']==[p['manifestSha256'] for p in packets], 'Packet hash indexes drifted'
  assert {'fixtureSha256':record['fixtureSha256'],'manifestSha256':record['manifestSha256']} in packets, 'Original reviewed packet must remain bound'
  requests=record['requestCases'];assert isinstance(requests,list) and requests, 'Exact approved request cases required'
  pattern='^'+re.sub(r':[A-Za-z][A-Za-z0-9_]*','[^/?#]+',re.escape(template).replace(r'\:',':'))+'$'
  for c in requests:
   assert set(c)=={'id','method','path'} and c['method']=='GET' and isinstance(c['id'],str) and c['id'] and c['id'] not in request_ids, 'Duplicate or non-GET approved request';request_ids.add(c['id'])
   request_path=c['path'];assert isinstance(request_path,str) and request_path.startswith('/') and not request_path.startswith('//') and not any(b in request_path.lower() for b in ['#','\\']) and not any(b in request_path.split('?',1)[0].lower() for b in ['/../','/./','%2f','%5c','%2e']), 'Noncanonical approved request path'
   assert re.fullmatch(pattern,request_path.split('?',1)[0]), 'Approved request does not bind its exact URL template'
   assert conditional_request_admitted([record],c['id'],'GET',request_path,packets[0]['fixtureSha256'],packets[0]['manifestSha256']), 'Reviewed request pair not admitted'
 for artifact in [eligibility,matrix]:
  for d in artifact['declarations']:
   expected=[r for r in records if r['declarationId']==d['declarationId']]
   assert d.get('conditionalReadAdmissions',[])==expected, 'Per-declaration conditional metadata drifted'
 total=handler_templates|conditional_templates;construction=handler_conditional|conditional_construction
 derived={'potentialEligibleHandlerWideSourceURLTemplates':len(handler_templates),'potentialEligibleExplicitBranchConditionalSourceURLTemplates':len(conditional_templates),'potentialEligibleExpectedSourceURLTemplates':len(total),'potentialEligibleUnconditionalConstructionURLTemplates':len(total-construction),'potentialEligibleConditionalConstructionURLTemplates':len(construction)}
 for key,value in derived.items():
  if key in ['potentialEligibleHandlerWideSourceURLTemplates','potentialEligibleExplicitBranchConditionalSourceURLTemplates'] and not records and key not in matrix['counts']:continue
  assert matrix['counts'][key]==value, 'Derived conditional denominator disagrees with matrix: '+key
 if records:assert eligibility['counts']['explicitlyReviewedConditionalReadDeclarations']==len({r['declarationId'] for r in records})
 return dict(derived,conditionalReadAdmissions=records,scope='Potential source-bound read branches only; exact approved case/query and same fixture+manifest pair required. Broad handler exclusions retained; no HTTP execution, independent correctness, or installed-live credit is created.')

parser=argparse.ArgumentParser(description='Reconcile captured declarations with reviewed source effects and historical mount gaps; never probe HTTP')
parser.add_argument('--source-root',required=True);parser.add_argument('--capture',required=True);parser.add_argument('--layer-receipt',required=True);parser.add_argument('--output-file',required=True);parser.add_argument('--update-mounted-inventory',action='store_true')
args=parser.parse_args();os.chdir(pathlib.Path(args.source_root).resolve())
base='tests/readiness/application-modules/'
s=json.load(open(args.capture))
x=json.load(open(base+'http-mounted-readonly-inventory.json'))
receipt=args.layer_receipt
graph=json.load(open(receipt))['proof']['graph']
read=[r for r in s['calls'] if r['method']=='get']
by={(r['file'],r['line']):r for r in read}
# Factories/mounts are independently traced. Mount presence does not grant effect clearance.
bindings={
 'schoolLifecycle.mjs':('/api/v1/school/lifecycle',['modules/school/server/composition/schoolLifecycle.mjs:300-318,1505','modules/school/server/composition/lifecycle-runtime.mjs:850-852'],'lifecycle enabled; optional agenda variants retain separate declaration IDs'),
 'school.selfservice.mjs':('/api/v1/school/self-service',['modules/school/server/composition/schoolLifecycle.mjs:1530-1543','modules/school/server/composition/lifecycle-runtime.mjs:863-865'],'lifecycle plus selfService.enabled'),
 'schoolVirtualDevices.mjs':('/api/v1/school/devices',['modules/school/server/composition/schoolLifecycle.mjs:1546-1552','modules/school/server/composition/lifecycle-runtime.mjs:856-858'],'virtualDevices true; simulation-only conditional surface'),
 'schoolCalc.mjs':('/api/v1/school/calc',['modules/school/server/composition/schoolCalc.mjs:50,144','modules/school/server/composition/lifecycle-runtime.mjs:733','modules/school/server/api/school.mjs:1469'],'SchoolCalc configuration and composed router required'),
 'schoolBookScans.mjs':('/api/v1/school/book-scans',['modules/school/server/composition/lifecycle-runtime.mjs:831-832'],'wired lifecycle, book grants/shelf and bookScans'),
 'schoolBooks.mjs':('/api/v1/school/books',['modules/school/server/composition/lifecycle-runtime.mjs:831-845'],'wired lifecycle, book grants/shelf'),
 'reading.mjs':('/api/v1/school/reading',['modules/school/server/composition/reading-runtime.mjs:6-11,95-98'],'wired lifecycle and story-time launcher'),
 'mediaLesson.mjs':('/api/v1/school/lesson',['backend/src/app.mjs:2669-2677'],'wired lifecycle, sessions/curriculum/recordMediaCompletion'),
 'weekly-review.mjs':('/api/v1/weekly-review',['backend/src/app.mjs:4005','backend/src/4_api/v1/routers/api.mjs:146'],'immich configuration and runtime installer; service effects still untraced'),
 'queries.mjs':('/api/v1/queries',['backend/src/5_composition/modules/contentApi.mjs:112','backend/src/4_api/v1/routers/api.mjs:141'],'savedQueryService required; parent assignment unresolved'),
}
# Explicit finite expansions of all ten former nonliteral GET declarations.
for r in read:
 f=os.path.basename(r['file']);e=r['pathExpression'];expanded=[]
 if f=='piano.mjs' and '${family}' in e:
  suffix='/:id' if '/:id' in e else '';expanded=['/api/v1/piano/producer/'+k+suffix for k in ['loops','crate','songs']]
 elif f=='school.cardLadder.mjs':
  if '${base}' in e:
   suffix=e.split('${base}',1)[1].rstrip('`');expanded=['/api/v1/school'+root+mode+suffix for root in ['/card-ladder','/word-ladder'] for mode in ['/test','']]
  else:
   suffix=e.split('${root}',1)[1].rstrip('`');expanded=['/api/v1/school'+root+suffix for root in ['/card-ladder','/word-ladder']]
 elif f=='school.teacherReading.mjs':expanded=['/api/v1/school/teacher/learners/:learnerId/reading'+('/:readingId' if '/:readingId' in e else '')]
 if expanded:r['expandedTemplates']=expanded
# Complete Device GET family, including '/' and '/config' missed by local-path-only reconciliation.
device=[]
command_paths=['/:deviceId/on','/:deviceId/off','/:deviceId/toggle','/:deviceId/screen/toggle','/:deviceId/screen/:state','/:deviceId/load','/:deviceId/volume/:level','/:deviceId/audio/:audioDevice']
for r in read:
 if not r['file'].endswith('/routers/device.mjs'):continue
 p=r['literalPaths'][0]
 cls='finite-safe'; reason='Finite config/cached memory projection; no command dispatched'; proof=[]
 if p in command_paths:
  cls='read-with-effects';reason='GET dispatches a power, screen, load, volume or audio command; not authorized for live probes'
  proof=['backend/src/3_applications/devices/services/DeviceFleetControlService.mjs:28-49,76-99,180','backend/src/3_applications/devices/services/DeviceScreenControlService.mjs:11-20,57','backend/src/3_applications/devices/services/DeviceContentDispatchService.mjs:load']
 elif p=='/:deviceId/screen/override':
  cls='read-with-effects';reason='Getter deletes expired override from shared map; finite cached read has an in-memory side effect'
  proof=['backend/src/3_applications/devices/services/DeviceScreenControlService.mjs:10','backend/src/3_applications/devices/services/ScreenOverrideService.mjs:33-40']
 elif p in ['/:deviceId','/:deviceId/volume']:
  cls='stream-or-external';reason='Reads actual device status/volume through concrete hardware adapters; no live probes'
  proof=['backend/src/3_applications/devices/services/DeviceFleetControlService.mjs:10-13,102-115','backend/src/3_applications/devices/services/Device.mjs:318-322,417-433']
 elif p=='/:deviceId/presence':proof=['backend/src/3_applications/devices/services/DevicePresenceService.mjs:12-15','backend/src/1_adapters/devices/PresenceStore.mjs:110-116','backend/src/app.mjs:2570','modules/school/server/application/LanguageStudyService.mjs:101-109','modules/school/server/composition/language-runtime.mjs:110-123']
 elif p=='/:deviceId/session':proof=['backend/src/3_applications/devices/services/DeviceSessionApiService.mjs:10','backend/src/3_applications/devices/services/SessionControlService.mjs:191-196','backend/src/3_applications/devices/services/DeviceLivenessService.mjs:118-127']
 elif p=='/:deviceId/start-status':proof=['backend/src/3_applications/devices/services/DeviceStartStatusService.mjs:57-63']
 else:proof=['backend/src/3_applications/devices/services/DeviceFleetControlService.mjs:8-9','backend/src/3_applications/devices/services/DeviceService.mjs:106-120','backend/src/3_applications/devices/services/Device.mjs:441-465']
 device.append({'declarationId':r['declarationId'],'template':'/api/v1/device'+(p if p!='/' else ''),'classification':cls,'reason':reason,'sourceProof':[r['file']+':'+str(r['line'])]+proof,'liveRequestAuthorized':False,'inheritedPolicy':'No cookies/Bearer; config/registry may contain sensitive fields, outside fixture projection scope'})
 r['effectClassification']=cls;r['effectProof']=device[-1]['sourceProof']
for old in x['unmatchedStaticGET']:
 r=by.get((old['file'],old['line']));assert r,'Declaration line must be refreshed explicitly if source moves'
 old['declarationId']=r['declarationId'];f=os.path.basename(old['file']);rec=old['reconciliation']
 if f=='device.mjs':rec['mountResolution']='source-resolved-opaque-wrapper';rec['resolvedTemplates']=['/api/v1/device'+p for p in old['literalPaths']];old['effectClassification']=r['effectClassification'];old['effectProof']=r['effectProof']
 elif r.get('expandedTemplates'):
  rec.update(mountResolution='source-resolved-finite-expansion',resolvedTemplates=r['expandedTemplates'],evidence=rec.get('evidence',[])+[r['file']+':'+str(r['line']), 'modules/school/server/api/school.mjs:559,1168'] if f.startswith('school.') else [r['file']+':759-777']);old['effectClassification']='unresolved';old['effectUnknown']='Called services and auth gates still require complete trace; expansion grants no live request permission'
 elif f in bindings:
  prefix,proof,condition=bindings[f];rec.update(mountResolution='source-resolved-conditional' if f!='queries.mjs' else 'factory-resolved-parent-unresolved',resolvedTemplates=[prefix+p for p in old['literalPaths']],evidence=proof,condition=condition);old['effectClassification']='conditional';old['effectUnknown']='Mount/config condition resolved; service effects untraced and live availability unknown'
 elif rec['classification']=='conditional-fixture-mount-absent':rec['mountResolution']='source-resolved-conditional';old['effectClassification']='conditional'
 else:rec['mountResolution']='unresolved-parent-or-factory';old['effectClassification']='unresolved'
# Preserve separate guard variants even if they answer the same URL.
for r in read:
 r.setdefault('effectClassification','unresolved');r.setdefault('effectProof',[])
 if r.get('expandedTemplates'):r['aliasIds']=[r['declarationId']+'@'+p for p in r['expandedTemplates']]
# Reuse source-reviewed route clearance only on exact file + literal local path binding and unchanged source bytes.
for r in read:
 if r['effectClassification']!='unresolved':continue
 matches=[c for c in x['readOnlyCandidates'] if c.get('method')=='GET' and c.get('localPath') in r['literalPaths'] and any(p.startswith(r['file']+':') for p in c.get('sourceProof',[]))]
 if not matches:continue
 dispositions={c['disposition'] for c in matches}
 if dispositions=={'source-reviewed-read-only'}:r['effectClassification']='finite-safe'
 elif any(v in dispositions for v in ['excluded-side-effect','excluded-device-command','excluded-print','excluded-playback-allocation']):r['effectClassification']='read-with-effects'
 elif any(v in dispositions for v in ['blocked-nonlocal-provider','excluded-stream-provider','blocked-query-dependent-provider']):r['effectClassification']='stream-or-external'
 else:continue
 r['effectProof']=list(dict.fromkeys(p for c in matches for p in c.get('sourceProof',[])))
# Conditional mounts are kept separate from unresolved effect clearance.
for r in read:
 if r['effectClassification']=='unresolved' and os.path.basename(r['file']) in bindings:r['effectClassification']='conditional';r['effectProof']=bindings[os.path.basename(r['file'])][1]
factsPath=base+'http-reviewed-effect-facts.json'
if os.path.exists(factsPath):
 facts=json.load(open(factsPath))
 assert facts['candidateCommit']==s['ref'], 'Reviewed effect facts must match captured committed revision'
 for path,expected in facts['sourceSha256'].items():
  assert hashlib.sha256(open(path,'rb').read()).hexdigest()==expected, 'Reviewed dependency changed: '+path
 mountById={r['declarationId']:r for r in facts.get('mountFacts',[])}
 for old in x['unmatchedStaticGET']:
  if old['declarationId'] in mountById:
   fact=mountById.pop(old['declarationId'])
   old['reconciliation'].update(mountResolution=fact['mountResolution'],reason=fact['reason'],evidence=fact['sourceProof'],livePresence=fact['livePresence'])
 assert not mountById, 'Reviewed mount declarations missing'
 factById={r['declarationId']:r for r in facts['facts']}
 assert len(factById)==len(facts['facts'])
 for r in read:
  if r['declarationId'] in factById:
   fact=factById.pop(r['declarationId'])
   assert r['file']==fact['file'] and r['pathExpression']==fact['pathExpression']
   r['effectClassification']=fact['classification'];r['effectProof']=fact['sourceProof']
   r['reviewedEffectDetail']={k:fact[k] for k in ['family','reason','branchNotes']}
 assert not factById, 'Reviewed declarations missing from capture'
currentById={r['declarationId']:r for r in read}
for old in x['unmatchedStaticGET']:
 current=currentById[old['declarationId']]
 old['currentEffectClassification']=current['effectClassification']
 old['currentEffectProof']=current['effectProof']
rows=[{k:r[k] for k in ['declarationId','file','line','method','literalPaths','pathExpression','guards','effectClassification','effectProof','reviewedEffectDetail'] if k in r}|({'expandedTemplates':r['expandedTemplates'],'aliasIds':r['aliasIds']} if r.get('expandedTemplates') else {}) for r in read]
counts={'staticCalls':len(s['calls']),'literalRouteDeclarations':sum(r['classification']=='route-declaration' and bool(r['literalPaths']) for r in s['calls']),'getDeclarations':len(read),'literalGET':sum(bool(r['literalPaths']) for r in read),'dynamicGET':sum(not r['literalPaths'] for r in read),'dynamicExpandedTemplates':sum(len(r.get('expandedTemplates',[])) for r in read),'mountMiddlewareRecords':sum(r['method']=='use' for r in s['calls']),'GETEffectClassifications':dict(collections.Counter(r['effectClassification'] for r in read)),'historical100MountResolutions':dict(collections.Counter(r['reconciliation']['mountResolution'] for r in x['unmatchedStaticGET']))}
artifact={'schema':'daylight.http-denominator-reconciliation/v1','candidateCommit':s['ref'],'captureCommand':'node tests/readiness/application-modules/capture-http-declarations.cjs <source-root> <output-file>','sourceSha256':{r['file']:r['sourceSha256'] for r in s['calls']},'parseErrors':s['parseErrors'],'reviewedEffectFacts':factsPath,'counts':counts,'scope':'Current committed-source declarations; finite source family reconciliation. Not installed-live denominator and no percentage claimed. All non-GET/ALL handlers remain excluded from live read-only execution; inherited middleware and unresolved calls do not gain clearance.','identityPolicy':s['identityPolicy'],'deviceFamily':device,'GETDeclarations':rows,'nonGETPolicyAccounting':{'countsByMethod':dict(collections.Counter(r['method'] for r in s['calls'] if r['method']!='get')),'scope':'Mount records are not route coverage. Non-GET mutations are outside live-read policy; ALL declarations remain blocked separately from explicit GET count.'},'unresolvedGate':'Unresolved or conditional effect classifications require further service/middleware trace. Distinct aliases/conditional handlers are retained; template expansion does not constitute execution coverage.'}
expectedMountPath=base+'http-expected-installed-route-matrix.json'
if os.path.exists(expectedMountPath):
 expectedMount=json.load(open(expectedMountPath))
 assert expectedMount['schema']=='daylight.expected-installed-route-matrix/v1'
 assert expectedMount['candidateCommit']==s['ref'], 'Expected mount matrix candidate changed'
 assert {r['declarationId'] for r in expectedMount['declarations']}==set(currentById), 'Expected mount matrix declaration coverage changed'
 for path,expected in expectedMount['sourceSha256'].items():
  assert hashlib.sha256(open(path,'rb').read()).hexdigest()==expected, 'Expected mount source changed: '+path
 eligibilityPath=base+'http-readonly-eligibility.json'
 if os.path.exists(eligibilityPath):
  eligibility=json.load(open(eligibilityPath))
  conditional=reconcile_conditional_reads(facts,eligibility,expectedMount,currentById)
  artifact['conditionalReadAdmissions']=conditional['conditionalReadAdmissions']
  artifact['derivedConditionalReadEligibility']={k:v for k,v in conditional.items() if k!='conditionalReadAdmissions'}
  for row in artifact['GETDeclarations']:
   approved=[r for r in conditional['conditionalReadAdmissions'] if r['declarationId']==row['declarationId']]
   if approved:row['conditionalReadAdmissions']=approved
 else:
  assert not facts.get('conditionalReadAdmissions'), 'Conditional facts require complete readonly eligibility mirror'
 artifact['expectedInstalledMountAccounting']={'artifact':expectedMountPath,'referenceCommit':expectedMount['referenceCommit'],'counts':expectedMount['counts'],'evidenceKind':expectedMount['evidenceKind'],'scope':'Source-derived expected config-pinned graph; actual production environment/config/loading and optional construction proofs remain separate. No observed-live denominator or request authorization.'}
open(args.output_file,'w').write(json.dumps(artifact,indent=2)+'\n')
x['currentDenominatorReconciliation']={'artifact':base+'http-denominator-reconciliation.json','candidateCommit':s['ref'],'counts':counts,'historicalInventoryRetained':True,'knownRemainingMountGaps':'Current100 historical declarations have78 source mount/expansion bindings and22 source-unwired dispositions in reviewed production boot. No remaining record lacks a source disposition; installed-live presence and unresolved transitive effects remain unknown. Source-unwired is not a live absence claim.'}
if args.update_mounted_inventory:
 open(base+'http-mounted-readonly-inventory.json','w').write(json.dumps(x,indent=2)+'\n')
print(json.dumps(counts));print('device',dict(collections.Counter(r['classification'] for r in device)))
