import json,hashlib,collections,os
import argparse, pathlib
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
 artifact['expectedInstalledMountAccounting']={'artifact':expectedMountPath,'referenceCommit':expectedMount['referenceCommit'],'counts':expectedMount['counts'],'evidenceKind':expectedMount['evidenceKind'],'scope':'Source-derived expected config-pinned graph; actual production environment/config/loading and optional construction proofs remain separate. No observed-live denominator or request authorization.'}
open(args.output_file,'w').write(json.dumps(artifact,indent=2)+'\n')
x['currentDenominatorReconciliation']={'artifact':base+'http-denominator-reconciliation.json','candidateCommit':s['ref'],'counts':counts,'historicalInventoryRetained':True,'knownRemainingMountGaps':'Current100 historical declarations have78 source mount/expansion bindings and22 source-unwired dispositions in reviewed production boot. No remaining record lacks a source disposition; installed-live presence and unresolved transitive effects remain unknown. Source-unwired is not a live absence claim.'}
if args.update_mounted_inventory:
 open(base+'http-mounted-readonly-inventory.json','w').write(json.dumps(x,indent=2)+'\n')
print(json.dumps(counts));print('device',dict(collections.Counter(r['classification'] for r in device)))
