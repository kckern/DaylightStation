/** Reconcile actual discovery and stable functional contract IDs with explicit gaps. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root,packet,emit} from './census.mjs';
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const contracts=read('contracts.json'),population=read('test-population.json'),index=read('evidence-index.json');
const discovery=index.latest['vitest-discover'];
if(!discovery?.fresh||discovery.exitCode!==0)throw new Error('Fresh successful discovery required');
const discovered=read(discovery.file).outcome;
population.dedicatedDiscovery={evidence:discovery.file,count:discovered.length,files:discovered,config:'tests/preimplementation/application-modules/configs/vitest.config.mjs',caseExpansion:'files-only: not performed',defaultRunnerEquivalence:false};
const defaultRun=index.latest['vitest-default-discover'];
if(defaultRun?.fresh&&defaultRun.exitCode===0){
  const defaultFiles=read(defaultRun.file).outcome.map(f=>f.file.replace('<worktree>/',''));
  const declared=new Set(population.files.map(f=>f.path)),found=new Set(defaultFiles),byCanonical=new Map();
  for(const file of defaultFiles){const canonical=path.relative(root,fs.realpathSync(path.join(root,file)));const paths=byCanonical.get(canonical)||[];paths.push(file);byCanonical.set(canonical,paths);}
  population.defaultVitestDiscovery={evidence:defaultRun.file,paths:defaultFiles.length,canonicalFiles:byCanonical.size,addedAliases:defaultFiles.filter(f=>!declared.has(f)),omittedTracked:[...declared].filter(f=>!found.has(f)),duplicateGroups:[...byCanonical].filter(([,paths])=>paths.length>1).map(([canonical,paths])=>({canonical,paths})),newPreparationCasesFound:defaultFiles.filter(f=>f.startsWith('tests/preimplementation/')),scope:'actual root include/exclude/aliases; safety/output overrides only; no case execution'};
}
population.newExecutedCases=contracts.cases;
const original=index.latest['vitest-stored-shape'];
population.existingSelectedExecution={evidence:original.file,source:'tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs',actualPassed:6,changed:false};
const result=read(original.file).outcome;
const oldCases=result.testResults.flatMap(file=>file.assertionResults).map((test,i)=>({id:'CASE-EXISTING-GR-STORED-'+String(i+1).padStart(2,'0'),description:test.fullName,source:'tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs',runner:'vitest',baselineResult:test.status,candidateResult:'candidate-pending',evidence:original.file,expectationBasis:'existing characterization assertions executed unchanged',normalization:'none added by preparation'}));
const printOriginal=index.latest['vitest-print-gateway'];
if(!printOriginal?.fresh||printOriginal.exitCode!==0)throw new Error('Fresh original image-print gateway evidence required');
const printFile='backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.test.mjs';
const printCases=read(printOriginal.file).outcome.testResults.flatMap(file=>file.assertionResults).map((test,i)=>({
  id:'CASE-EXISTING-GR-PRINT-'+String(i+1).padStart(2,'0'),description:test.fullName,source:printFile,
  runner:'vitest',baselineResult:test.status,candidateResult:'candidate-pending',evidence:printOriginal.file,
  expectationBasis:'original adapter assertion executed unchanged under isolated Vitest',normalization:'none added by preparation'}));
population.existingPrintGatewayExecution={evidence:printOriginal.file,source:printFile,actualPassed:printCases.filter(c=>c.baselineResult==='passed').length,changed:false};
const fileIOOriginal=index.latest['fileio-consumers'];
if(!fileIOOriginal?.fresh||fileIOOriginal.exitCode!==0||fileIOOriginal.passed!==36||fileIOOriginal.populationMatches!==true)throw new Error('Fresh original FileIO consumer suites required');
const fileIOResult=read(fileIOOriginal.file),fileIOCases=fileIOResult.outcome.testResults.flatMap(file=>file.assertionResults.map(test=>{
  const source=file.name.replace('<worktree>/','');
  return {id:'CASE-EXISTING-FILEIO-'+createHash('sha256').update(source+':'+test.fullName).digest('hex').slice(0,16),description:test.fullName,source,
    runner:'vitest',baselineResult:test.status,candidateResult:'candidate-pending',evidence:fileIOOriginal.file,
    expectationBasis:'unchanged original consumer assertion, including expanded parameterized cases; six-suite scope reviewed',normalization:'none added by preparation'};
}));
if(fileIOCases.length!==36||new Set(fileIOCases.map(c=>c.id)).size!==36)throw new Error('FileIO original case identity mismatch');
population.existingFileIOExecution={evidence:fileIOOriginal.file,files:fileIOResult.population,actualPassed:fileIOCases.filter(c=>c.baselineResult==='passed').length,changed:false};
const serverOriginal=index.latest['server-foundation'];
if(!serverOriginal?.fresh||serverOriginal.exitCode!==0||serverOriginal.passed!==64||serverOriginal.populationMatches!==true)throw new Error('Fresh original server-foundation suites required');
const serverResult=read(serverOriginal.file),serverCases=serverResult.outcome.testResults.flatMap(file=>file.assertionResults.map(test=>{
  const source=file.name.replace('<worktree>/','');
  return {id:'CASE-EXISTING-SERVER-'+createHash('sha256').update(source+':'+test.fullName).digest('hex').slice(0,16),description:test.fullName,source,
    runner:'vitest',baselineResult:test.status,candidateResult:'candidate-pending',evidence:serverOriginal.file,
    expectationBasis:'unchanged original error middleware/logging assertion; four files with fake transports/response objects/timers, no listener or controller',normalization:'none added by preparation'};
}));
if(serverCases.length!==64||new Set(serverCases.map(c=>c.id)).size!==64)throw new Error('Server foundation original case identity mismatch');
population.existingServerFoundationExecution={evidence:serverOriginal.file,files:serverResult.population,actualPassed:serverCases.filter(c=>c.baselineResult==='passed').length,changed:false};
contracts.cases=contracts.cases.filter(c=>!c.id.startsWith('CASE-EXISTING-')).concat(oldCases,printCases,fileIOCases,serverCases);
const httpRun=index.latest['http-middleware'],httpCases=contracts.cases.filter(c=>c.id.startsWith('CASE-HTTP-'));
if(!httpRun?.fresh||httpRun.exitCode!==0||httpRun.passed!==37||httpRun.populationMatches!==true
  ||httpCases.length!==37||httpCases.some(c=>c.baselineResult!=='passed'||c.evidence!==httpRun.file))throw new Error('Fresh complete HTTP middleware case population required');
population.httpMiddlewareExecution={evidence:httpRun.file,actualPassed:37,source:'tests/preimplementation/application-modules/cases/http-middleware.case.mjs',scope:'original code over memory-only response/event doubles; not socket/full controller/native candidate'};
const prefixes={
  'CTR-GR-DATA-01':['CASE-EXISTING-GR-STORED-','CASE-GR-SELECTION-HISTORY','CASE-GR-DISK'],
  'CTR-GR-DATA-02':['CASE-GR-HTTP-07','CASE-GR-HTTP-08','CASE-GR-HTTP-10','CASE-GR-RECYCLE'],
  'CTR-GR-DATA-03':['CASE-GR-HTTP-11','CASE-GR-HTTP-12','CASE-GR-HTTP-13','CASE-GR-SNAPSHOT'],
  'CTR-GR-PRINT-01':['CASE-GR-PRESENTATION'],
  'CTR-GR-PRINT-02':['CASE-GR-RENDER'],
  'CTR-GR-PRINT-03':['CASE-GR-HTTP-18','CASE-GR-PRINT-NOLOCATION','CASE-GR-PRINT-NOTFOUND','CASE-GR-PRINT-UNCONFIGURED','CASE-GR-TEMP','CASE-EXISTING-GR-PRINT-'],
  'CTR-GR-UI-01':['CASE-GR-UI-BOOTSTRAP','CASE-GR-UI-ERROR','CASE-GR-UI-EMPTY','CASE-GR-UI-SELECT','CASE-GR-UI-USER','CASE-GR-UI-DISCARD','CASE-GR-UI-UNDO','CASE-GR-UI-EXIT'],
  'CTR-GR-UI-02':['CASE-GR-UI-ORPHAN','CASE-GR-UI-LONGPRESS','CASE-GR-UI-INFLIGHT'],
  'CTR-GR-EVENT-01':['CASE-GR-HTTP-14','CASE-GR-UI-HOMEBOT','CASE-GR-UI-EXTERNAL','CASE-GR-UI-CUSTOMTYPE','CASE-GR-UI-CLEANUP'],
  'CTR-GR-CONSUMER-01':['CASE-GR-FAMILY','CASE-GR-APP-PARAMS'],
  'CTR-GR-CONSUMER-02':['CASE-GR-FEED'],
  'CTR-GR-CONSUMER-03':['CASE-GR-HOMEBOT'],
  'CTR-GR-CONSUMER-04':['CASE-GR-ADMIN','CASE-GR-CONFIG-RELOAD'],
  'CTR-GR-COMPOSE-01':['CASE-GR-HTTP','CASE-GR-ACCESS','CASE-GR-WIRE'],
  'CTR-GR-ARTIFACT-01':['CASE-GR-RENDER-NATIVE'],
  'CTR-GR-RECOVERY-01':[],
  'CTR-ARCH-01':['CASE-ARCH-CURRENT','CASE-ARCH-PROTOTYPE-LAYER','CASE-ARCH-PROTOTYPE-RANK'],
  'CTR-ARCH-02':['CASE-ARCH-PROTOTYPE-UNKNOWN','CASE-ARCH-PROTOTYPE-PRIVATE','CASE-ARCH-PROTOTYPE-PORT','CASE-ARCH-PROTOTYPE-NAMING','CASE-ARCH-PROTOTYPE-HOST','CASE-ARCH-PROTOTYPE-COMPUTED'],
  'CTR-TEST-01':['CASE-ISO'],
  'CTR-PACKAGE-01':['CASE-PKG'],
  'CTR-BUILD-01':[]
};
const plan=fs.readFileSync(path.join(root,'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md'),'utf8');
const appendix=plan.split('## Appendix B')[1].split('## Appendix C')[0];
const families=[...appendix.matchAll(/^\| (CTR-[A-Z0-9-]+) \| (.+) \|$/gm)].map(([,id,scope])=>({id,owner:id.startsWith('CTR-GR-')?'gratitude and named consumers':'cross-owner architecture/build/test',source:'accepted preimplementation plan Appendix B; exact executable source in linked case records',consumer:'current installed system and prospective module consumers',preconditions:'fresh isolated synthetic fixture; external effects denied or fake; no candidate exists',requiredBehavior:scope,caseIds:contracts.cases.filter(c=>(prefixes[id]||[]).some(p=>c.id.startsWith(p))).map(c=>c.id),status:'partial baseline specification; remaining scenario oracles in coverage-and-gaps.md',criticality:'migration-blocking when affected',inputAndOracle:'explicit current test body for each linked case; missing cases are not test-ready',effectsAndCleanup:'asserted per current case; complete effect matrix still open',expectedErrors:'per current case; missing errors explicitly remain coverage gaps',gap:'GAP-'+id,candidateResult:'candidate-pending'}));
contracts.contracts=contracts.contracts.filter(c=>c.id.startsWith('CTR-GR-HTTP-')).concat(families);
Object.assign(contracts.contracts.find(c=>c.id==='CTR-GR-CONSUMER-02'),{
  boundarySpecification:'feed-boundary.json',
  proposedOperation:'createGratitudeServices(...).gratitudeQueries.readSelectionQuotes; injected into Feed as readGratitudeQuotes',
  status:'twelve baseline cases plus exact selected synchronous lazy-view interface; candidate execution and new boundary negative controls remain pending',
  preserveOrder:'one read, query limit, iteration/shuffle/slice, selected text/user/display, then timestamps/bundle fields; no eager row normalization or added await'
});
Object.assign(contracts.contracts.find(c=>c.id==='CTR-GR-CONSUMER-03'),{
  boundarySpecification:'homebot-boundary.json',
  proposedOperation:'createGratitudeServices(...).gratitudeCommands.addSelections; composition supplies addGratitudeSelections to Homebot-owned gateway adapter',
  status:'eleven baseline Homebot/batch cases plus exact command/port/bridge and source-edit specification; candidate and four new negative controls remain pending',
  preserveOrder:'state/default household/timestamp, await sequential batch, optional name, unawaited broadcast, message, state deletion; no duplicate validation, transaction or compensation added'
});
contracts.contracts.push({id:'CTR-HOUSEHOLD-PROJECTION-01',owner:'household identity capability and Gratitude/Homebot projection consumers',
  source:'household-boundary.json; original GratitudeHouseholdService, ConfigHouseholdAdapter, ConfigUserDirectory, ConfigService and Gratitude API/router composition',
  consumer:'Gratitude bootstrap, FamilySelector/parameter resolver and Homebot confirmation/member selection',
  preconditions:'Original inert helpers/accessors with synthetic config, one task-only disk/refresh fixture, fixed Date and deliberate throwing dependencies; original router over memory-only HTTP; no private profiles or controller',
  requiredBehavior:'Preserve ordered duplicate roster entries, roster versus confirmation names, optional versus required provider methods, null/object ID handling, cached profile observation and caller-specific timezone/category policy',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-HOUSEHOLD-PROJECTION-')).map(c=>c.id),
  inputAndOracle:'Nine registrations.case.mjs cases compare projection shapes/types/order, general-directory contrast, fixed-clock UTC/locale behavior, explicit reload visibility and actual HTTP projection/error/spread order',
  boundarySpecification:'household-boundary.json',
  status:'nine original projection cases and exact shared query/source/client/manifest proposal; candidate, new negative controls and global package/metadata/build gates remain pending',
  criticality:'migration-blocking when shared projection is extracted',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-HTTP-REGISTRATION-01', owner:'installed HTTP composition and named product/capability owners',
  source:'api-registration-audit.json; exact original factories and helper calls linked by source',
  consumer:'API callers, native agent clients and concierge clients',
  preconditions:'Original inert router/helper factories, synthetic capabilities, actual Express/Node serialization; network and controller startup denied',
  requiredBehavior:'Preserve omitted/supplied route-map keys, USE proxy method/prefix/fallback semantics, rewrite order, native JSON/background/SSE, supplied concierge auth/wire format and legacy admin baseline quirks',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-REG-')).map(c=>c.id),
  inputAndOracle:'Each named case in cases/registrations.case.mjs supplies exact request and asserts response/effect ordering',
  status:'selected baseline helper contracts executed; not exhaustive request/auth/error coverage or controller composition',
  criticality:'migration-blocking if affected by the chosen shared/composition changeset',
  candidateResult:'candidate-pending', gap:'Full controller and real provider activation remain separate gates'});
contracts.contracts.push({id:'CTR-INTEGRATION-REGISTRATION-01', owner:'installed integration composition',
  source:'provider-lifecycle-review.json; AdapterRegistry and IntegrationLoader original source',
  consumer:'configured household capabilities and their application consumers',
  preconditions:'Synthetic discovery and adapter factories; no real provider module imported or configured',
  requiredBehavior:'Retain distinction between manifest indexing and lazy construction, duplicate-key last-write behavior, configuration precedence and current repeat-load instance/disposal semantics',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-PROVIDER-')).map(c=>c.id),
  inputAndOracle:'Two named cases in cases/registrations.case.mjs assert indexing order, constructor count, instance identity and exact synthetic merged configuration',
  status:'selected original loader behavior executed; actual filesystem enumeration order/provider implementations and full lifecycle remain unverified',
  criticality:'migration-blocking if provider enumeration or integration loader is affected', candidateResult:'candidate-pending'});
for(const contract of contracts.contracts.filter(c=>c.casePrefix))contract.caseIds=contracts.cases.filter(c=>c.id.startsWith(contract.casePrefix)).map(c=>c.id);
contracts.contracts.push({id:'CTR-RESOURCE-01',owner:'static-assets, shared rendering and installed resource composition',
  source:'resource-review.json and original static router/service/repository/CanvasFactory source',consumer:'Gratitude, FamilySelector, renderers and other public image consumers',
  preconditions:'Original source with synthetic image root and fake resize capability; real installed canvas; no live image/font mounts',
  requiredBehavior:'Preserve generic versus typed avatar routes, exact/extension probing, cache/content headers, raster resize fallback and best-effort optional font registration',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-RESOURCE-')).map(c=>c.id),inputAndOracle:'Named tests in cases/rendering.case.mjs; static bytes and response headers compared directly',
  status:'selected baseline resource behavior verified, not full Sass/public/native/image/client parity',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-SATELLITE-WIRE-01',owner:'hardware input capability and satellite/installed composition owners',
  source:'wire-contract-review.json and original PressureMatAdapter',consumer:'normalized presence subscribers, history and device command callers',
  preconditions:'Fake event bus/clock and HTTP refusal; no firmware or live device',
  requiredBehavior:'Preserve field normalization, receipt-clock online status, unconfigured reading acceptance, command topic/field names and delivery-count semantics; firmware clamps remain distinct',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-PRESSURE-')).map(c=>c.id),inputAndOracle:'Two named cases in cases/registrations.case.mjs assert normalized fields and captured bus calls',
  status:'selected pressure-mat adapter cases verified; Piano and remaining satellite replay/build protocols still open',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-PROFILE-REPRESENTATION-01',owner:'identity persistence and Fitness integration owners',
  source:'wire-contract-review.json; original host/Fitness profile helpers, central profile writer and identity index',consumer:'enrollment/profile writers and identity/gallery consumers',
  preconditions:'Synthetic objects and synchronous injected persistence/cache spies; no biometric or real profile data',
  requiredBehavior:'Keep differing optional field and undefined-input behavior, duplicate gallery versus last-owner index semantics, shallow copying and write/refresh order including false/throw outcomes',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-FINGERPRINT-')).map(c=>c.id),inputAndOracle:'Three original-helper cases in cases/registrations.case.mjs compare own properties, ordered projections and captured side-effect sequence',
  status:'selected original helper/writer behavior verified; not enrollment, template storage or disk/cache durability proof',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-PORTAL-INPUT-01',owner:'screen input integration and shared volume context',
  source:'wire-contract-review.json; original Portal volume hook, HID dispatcher and context',consumer:'screen-host browser focus/text/activation and shared volume consumers',
  preconditions:'jsdom with actual React/context and fake WebSocket constructor; no device, network or audio graph',
  requiredBehavior:'Preserve keyboard validation/default prevention and manual DOM actions, volume down/up/panel-flag semantics, current handler identity and socket cleanup',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-PORTAL-')).map(c=>c.id),inputAndOracle:'Three cases in cases/browser.case.mjs compare exact DOM values/events/focus and injected step/socket calls',
  status:'selected browser input contracts verified; Android capture, reconnect timing, control plane and actual browser/audio remain open',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.gaps=contracts.gaps.map(g=>g.id==='GAP-GR-UI'?{...g,scope:'remaining actual-browser layout/AppContainer launch, repeat/blur/persisted state and additional Family/Admin scenarios',next:'extend existing real-component fake-backed pack and later isolated real-browser tests; no live controller'}:g);
contracts.contracts.push({id:'CTR-RELAY-DISPATCH-01',owner:'hardware/scan/nutrition integration owners',
  source:'wire-contract-review.json; original firmware gateways and OMR application relay',consumer:'barcode/scale/OMR topic consumers and semantic day-log ports',
  preconditions:'Synthetic frames, in-memory bus, promise-gated/failed persistence and selected controlled clock; no hardware or files',
  requiredBehavior:'Retain shared-source type discrimination, legacy sources, field coercion/projection and default topics, receipt versus age-rebased timestamps, listener veto differences and echo-before-persistence semantics',
  caseIds:contracts.cases.filter(c=>c.id==='CASE-WIRE-KITCHEN-DISPATCH'||c.id.startsWith('CASE-WIRE-OMR-')).map(c=>c.id),
  inputAndOracle:'Three cases in cases/registrations.case.mjs assert exact normalized events and timing/order of publish versus synthetic writes',
  status:'selected original gateway/policy behavior verified; not device encoder, queue, whole dispatch/grade or durable delivery proof',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-AUTOMOTIVE-ACK-01',owner:'automotive product and firmware transport integration',
  source:'wire-contract-review.json; original AutomotiveFirmwareGateway and automotiveRelay',consumer:'trip store, summary log, topic subscribers and vehicle ack receiver',
  preconditions:'Synthetic trip chunks, fake bus and promise-controlled store/log operations; no vehicle, network or trip files',
  requiredBehavior:'Retain arrival-order chunk accumulation despite seq, early domain publication, trip/log-before-first-ack sequence, failure withholding and existing-trip retry bypass of summary repair',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-AUTOMOTIVE-')).map(c=>c.id),
  inputAndOracle:'Two cases in cases/registrations.case.mjs inspect saved sample order, call sequence and exact direct trip-ack payload',
  status:'selected original assembly/ack behavior verified; physical deletion, store durability and complete clock/telemetry matrix remain open',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-EINK-WIRE-01',owner:'eink capability and installed screen configuration',
  source:'wire-contract-review.json; original createEinkRouter and paired firmware parser source',consumer:'sleeping panels and telemetry/status clients',
  preconditions:'Original router over in-memory HTTP with fake panel service, synthetic image bytes and telemetry spy; no render/hardware/data',
  requiredBehavior:'Keep plain-text key order/trailing newline/encoded image path, finite telemetry parsing and best-effort recording before snapshot, no-cache/unconditional PNG, GET action effects and not-yet-reported status',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-EINK-')).map(c=>c.id),
  inputAndOracle:'Two cases in cases/registrations.case.mjs compare exact body/headers/service calls, including If-None-Match request',
  status:'selected original HTTP wire behavior verified; no real PNG/dither/RTC/panel, image hash service or complete controller auth proof',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-HUB-WIRE-01',owner:'playback-hub owner and independent appliance integration',
  source:'wire-contract-review.json; original HttpPlaybackHubAdapter, domain value objects and Python/shell producer source',consumer:'hub command/status/audio-verification callers',
  preconditions:'Original adapter with injected requestRaw spy returning synthetic text and errors; no HTTP server, appliance, files or audio',
  requiredBehavior:'Preserve slot versus time identity, optional nulls and domain validation, queue prefixes and zero options, legacy all-target count projection independent of body.ok, modern filtering/reasons, 409 and transport failure semantics',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-HUB-')).map(c=>c.id),
  inputAndOracle:'Four cases in cases/registrations.case.mjs assert exact request options and status/result/error projections',
  status:'selected central adapter contracts verified; no Python/shell execution, durable config/queue/cache, audible output or complete control surface proof',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-PIANO-BRIDGE-WIRE-01',owner:'Piano product and Android native instrument integration',
  source:'wire-contract-review.json; original usePianoBridgeNotes/resetPianoBridge plus paired Android source',consumer:'Piano kiosk notes/effects and operator repair UI',
  preconditions:'jsdom/fake WebSocket, synthetic fetch responses and one bounded abort timer; no MIDI, radio, Android or real HTTP',
  requiredBehavior:'Keep note dialect separate from recorder events, velocity defaults and speaker hysteresis, array/open-socket send conditions without false hardware ack, and literal fixed:true reset outcome with separate HTTP/parse/timeout/network errors',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-PIANO-')).map(c=>c.id),
  inputAndOracle:'One browser.case.mjs hook case and two registrations.case.mjs reset cases inspect captured notes/sends/status and exact repair results',
  status:'selected browser contracts verified; native encoding, other control/heartbeat routes, grace/reconnect, APK/payload identity and hardware repair remain open',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-FITNESS-SATELLITE-01',owner:'Fitness and biometric/device integration owners',
  source:'wire-contract-review.json; original EventBusBiometricGateway, continuousScanLoop and BleHeartRateDecoder',consumer:'manage/enrollment UI, central identity enrichment and fitness sensor consumers',
  preconditions:'Fake bus/IDs/timers and bounded scan policy with fake delay; raw byte arrays only, no templates/helper/hardware',
  requiredBehavior:'Keep request versus UI progress identities, result coercion/field drops/cross-kind correlation and timeout semantics, touch versus fault/missing-template scan outputs, backoff and existing ant-compatible BLE HR envelope',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-FITNESS-')).map(c=>c.id),
  inputAndOracle:'Four registrations.case.mjs cases inspect exact messages/results/timer entries, loop delays and normalized byte-packet output',
  status:'selected original JS boundaries verified; daemon/hardware/auth policy/template atomicity and lifecycle are not certified',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-SCHOOLCALC-INGRESS-SYNC-01',owner:'School calculator application and relay integration',
  source:'wire-contract-review.json; original SchoolCalcRelayCredentialVerifier, ingress middleware and SyncSchoolCalcDevice',consumer:'authenticated relay requests and batch acknowledgement consumers',
  preconditions:'Synthetic credentials, in-memory Express wire and injected operation spies; no whole router/controller/codec/store or device',
  requiredBehavior:'Retain exact Bearer syntax, optional asserted relay ID with mismatch rejection, immutable verified identity, strict current-batch acknowledgement selection, operation order and no inferred rollback after late failure',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-WIRE-SCHOOLCALC-')).map(c=>c.id),
  inputAndOracle:'Three registrations.case.mjs cases compare unauthorized/authorized wire responses and exact operation calls/byte counts',
  status:'selected auth and orchestration verified; not full body/codec/agenda authorization, ledger durability, C++/Z80/transfer or calculator commit proof',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-TI86-TRANSFER-FILE-01',owner:'School calculator tooling',
  source:'wire-contract-review.json; original createTi86StringFile',consumer:'TI String file readers and transfer tools',
  preconditions:'Synthetic Buffer payloads, no source generator/assembler/file write/ROM or calculator',
  requiredBehavior:'Preserve signature/name normalization, String type/length fields, exact record bytes and additive entry checksum without inventing semantic envelope validation',
  caseIds:contracts.cases.filter(c=>c.id==='CASE-WIRE-TI86-STRING-FILE').map(c=>c.id),
  inputAndOracle:'One registrations.case.mjs case inspects exact Buffer offsets/bytes/checksum and invalid name/type errors',
  status:'small transfer-file wrapper contract verified; not full encoded limits, CRC/record codec, Z80/QR/physical transfer or default release proof',criticality:'migration-blocking when affected',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-HOUSEHOLD-PROFILE-01',owner:'shared household identity with Admin, Auth and Fitness mutation policies',
  source:'storage-authorities.json profileMutations/profileCache/profileReferences; three original central persistence paths',
  consumer:'Gratitude and other cached roster/profile consumers, fresh account reads, invite enumeration and enrollment management',
  preconditions:'Original inert stores/services, three canonical temporary synthetic households, fake failing synchronous dependencies; no real account, token pipeline, enrollment device or controller',
  requiredBehavior:'Preserve shared profile path with different write algorithms, Admin/Fitness/Auth cache behavior, old Map/object and platform-index identity, retained deleted-member profile, mixed cached/fresh account reads, sequential partial failures and ignored false results',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-STORE-PROFILE-')).map(c=>c.id),
  inputAndOracle:'Six registrations.case.mjs cases inspect actual synthetic YAML, current/previous cached objects, explicit error identity, exact write order and omitted household scope argument',
  status:'named central writer behavior characterized; generic path dataflow, HTTP authorization, malformed-write recovery, boot index construction, concurrent writers and physical template transaction are not certified',
  criticality:'migration-blocking when shared storage/config/identity dependencies or named consumer wiring are changed',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-UTILITY-01',owner:'platform system utilities and rank-0 domain core',
  source:'utility-boundary.json; original core/system time, runtime ID and error modules',
  consumer:'Gratitude and retained product/system/test callers in the exact source-import table',
  preconditions:'Original inert helper modules under dedicated OS sandbox; synthetic dates/errors/IDs, no controller/config/provider calls; Date/Intl mutations restored',
  requiredBehavior:'Preserve explicit-date validation/fallbacks, LA default clocks, deterministic ID encoding/entropy formats, constructor/default/re-export identity and error subtype/context/status/retry policies',
  caseIds:contracts.cases.filter(c=>c.id.startsWith('CASE-UTILITY-')).map(c=>c.id),
  inputAndOracle:'Six explicit registrations.case.mjs cases with fixed dates, known ID vector, exact property/JSON assertions and source binding identity',
  boundarySpecification:'utility-boundary.json',criticality:'migration-blocking for affected shared utility relocation',
  status:'selected baseline contracts and export/import design; complete consumer coverage, candidate identity, new negative controls and reference/package gates remain pending',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-FILEIO-CONSUMERS-01',owner:'platform filesystem mechanism with Fitness, Piano, media/content adapter consumers',
  source:'fileio-boundary.json and fixtures/fileio-consumers.json; exact unchanged test/source paths in case records',
  consumer:'six selected existing mock-aware adapter suites out of 22 recognized mock sites and broader 306-file storage population',
  preconditions:'Dedicated Vitest config and existing scope loader; task-only real Workout YAML directory and original mock/map fixtures; OS denies network/private data/controller effects',
  requiredBehavior:'Preserve household workout storage/atomic primitive/normalization and ID rejection, FreshVideo lock/descriptor lifetime, Composer revisions/shared/version/blob deletion, Piano presets, media progress cache and actionable Strava jobs',
  caseIds:fileIOCases.map(c=>c.id),inputAndOracle:'36 unchanged original assertions, including five expanded Workout unsafe-ID cases; no copied/reimplemented product or assertion bodies',
  status:'six original suites pass on baseline; remaining sites, new 73-name public entry, real installed candidate and namespace/negative proofs remain pending',
  boundarySpecification:'fileio-boundary.json',criticality:'migration-blocking for affected filesystem/import/package changes',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-HTTP-MIDDLEWARE-01',owner:'platform system HTTP middleware',source:'http-boundary.json; original four middleware files',
  consumer:'82 direct import sites, mostly API routers plus controller/test consumers',preconditions:'Original four middleware functions with synthetic request/response/events, scoped clock mock and real dispatcher with in-memory transport; OS-denied network and private data',
  requiredBehavior:'Preserve error shape/status/webhook/trace handling, synchronous versus rejected async wrapper errors, finish/close sampling semantics and trace-header propagation',
  caseIds:[...serverCases.filter(c=>c.source==='tests/unit/system/errorHandlerString.test.mjs'),...httpCases].map(c=>c.id),
  inputAndOracle:'Ten unchanged errorHandlerString cases plus 37 dedicated cases: six promise/throw, four tracing, twelve response-log and fifteen error cases. Explicit assertions preserve field/order/type/default asymmetries. Four memory-only mutations fail exact intended sets; restored baseline passes. Loop rows are not separately counted cases.',
  status:'47 linked baseline cases; exact four-name public entry/87 edits and 1278 literal references specified. Real Express status/header/socket behavior, full controller order, computed reference/original consumer and native candidate gates remain pending',
  boundarySpecification:'http-boundary.json',criticality:'migration-blocking for shared middleware changes',candidateResult:'candidate-pending'});
contracts.contracts.push({id:'CTR-SERVER-LOGGING-01',owner:'platform system logging state and timestamp mechanics',source:'original logger.mjs, dispatcher.mjs and localTimestamp.mjs; fixtures/server-foundation.json',
  consumer:'HTTP middleware, retained backend emitters and ingestion/status consumers',preconditions:'Original implementations with fake transports, bounded fake timers, restored stdout/stderr spies and synthetic timestamps; no real sink/provider',
  requiredBehavior:'Preserve contextual logging, fallback channels, sampling aggregates, dispatcher priority/validation/metrics/reset and offset-bearing timestamps; keep runtime-zone logger versus dispatcher-configured missing-ts behavior distinct',
  caseIds:serverCases.filter(c=>c.source!=='tests/unit/system/errorHandlerString.test.mjs').map(c=>c.id),
  inputAndOracle:'54 unchanged assertions from logger, dispatcher and localTimestampOffset suites; separate logging-boundary.json native fixture has twelve identity/timezone/reset/sampling/transport probes, not extra baseline case IDs',
  status:'selected original baseline passed; four-entry logging specification and native fixture delivered. Actual test-only caller enforcement, complete package/consumer/transport proof and remaining behavior cases open',
  boundarySpecification:'logging-boundary.json',
  criticality:'migration-blocking for logging extraction or package scope changes',candidateResult:'candidate-pending'});
// These are planned coverage records, deliberately distinguished from executed
// baseline evidence.  They give the recovery/build families stable case IDs
// without claiming an unavailable candidate or build as green.
const plannedCases=[
  ['CASE-GR-RECOVERY-COLD','cold client: baseline-loaded client accepts candidate then rollback preserves current offline behavior'],
  ['CASE-GR-RECOVERY-WARM','warm client: already-loaded surface/settings/icon bindings transition and rollback without duplicate state'],
  ['CASE-GR-RECOVERY-LAZY','unopened lazy chunks remain unopened across candidate selection and rollback'],
  ['CASE-GR-RECOVERY-SW','service-worker/cache state has an explicit candidate and rollback disposition'],
  ['CASE-GR-RECOVERY-RECONNECT','reconnect state preserves the current event/provider cleanup contract through rollback'],
  ['CASE-BUILD-FROZEN-INPUTS','changed frozen toolchain or build-context input is rejected before candidate output is accepted'],
  ['CASE-BUILD-NATIVE-ASSET','missing or mismatched native/font asset produces the named build or rendering failure'],
  ['CASE-BUILD-OWNER-ROOT','missing owner package root or unsupported public asset URL is rejected'],
  ['CASE-BUILD-RESOLVER','public export resolution succeeds while a private subpath is rejected in the candidate build'],
  ['CASE-BUILD-PROVENANCE','candidate artifact records exact manifests, lock, resolver, and input hashes for comparison']
].map(([id,description])=>({id,description,runner:'future isolated browser/build candidate driver',source:'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md Appendix B',baselineResult:'not-run: candidate/build prerequisite not yet available',evidence:'Appendix B planned case record; no execution evidence',candidateResult:'candidate-pending',expectationBasis:'accepted Appendix B recovery/build seed; no behavior is inferred beyond the named scenario',normalization:'none permitted until the future runner declares a reviewed, field-specific normalization'}));
for(const planned of plannedCases) if(!contracts.cases.some(existing=>existing.id===planned.id)) contracts.cases.push(planned);
for(const contract of contracts.contracts){
  if(contract.id==='CTR-GR-RECOVERY-01') contract.caseIds=plannedCases.filter(item=>item.id.startsWith('CASE-GR-RECOVERY-')).map(item=>item.id);
  if(contract.id==='CTR-BUILD-01') contract.caseIds=plannedCases.filter(item=>item.id.startsWith('CASE-BUILD-')).map(item=>item.id);
}
// The initial route discovery is deliberately source-shaped.  Normalize it and
// the Appendix-B families here into the record shape that later case design
// must satisfy; do not manufacture a passing case from an empty field.
const appendixA=plan.split('## Appendix A')[1].split('## Appendix B')[0];
const routeRequirements=new Map([...appendixA.matchAll(/^\| (CTR-GR-HTTP-\d+) \| .+ \| (.+) \|$/gm)].map(([,id,requirement])=>[id,requirement]));
for(const contract of contracts.contracts){
  const routeRequirement=routeRequirements.get(contract.id);
  if(routeRequirement) contract.requiredBehavior=routeRequirement;
  contract.observableOutput ??= contract.requiredBehavior;
  contract.effectsAndCleanup ??= routeRequirement
    ? 'Endpoint-specific observable effects and cleanup are constrained by: '+routeRequirement
    : 'Observable state/effects/cleanup are constrained by the required behavior and each linked case; unrepresented effects remain an explicit catalog gap.';
  contract.expectedErrors ??= routeRequirement
    ? 'Endpoint-specific status/error translation is constrained by: '+routeRequirement
    : 'Expected failure behavior is the named error/rejection assertions in linked cases; unrepresented errors remain an explicit catalog gap.';
  contract.evidenceBasis ??= routeRequirement
    ? `${contract.source}:${contract.line}; Appendix A route seed; linked named case records`
    : `${contract.source}; Appendix B family seed and linked named case records`;
  contract.criticality ??= 'migration-blocking when the contract owner, registration, consumer, or public entry changes';
}
// Make each existing assertion source a portable, inspectable case oracle. The
// projection deliberately quotes only assertion expressions already present in
// the test body; it never turns a description or an observed baseline result
// into a new requirement.
const assertionPattern=/assert\.(?:equal|deepEqual|notDeepEqual|match|ok|throws|rejects|strictEqual|notEqual)\(/g;
const readAssertion=(text,start)=>{
  let quote=null,escape=false,depth=0;
  for(let i=start;i<text.length;i++){
    const character=text[i];
    if(quote){
      if(escape)escape=false;
      else if(character==='\\')escape=true;
      else if(character===quote)quote=null;
      continue;
    }
    if(character==='\''||character==='"'||character==='`'){quote=character;continue;}
    if(character==='('||character==='['||character==='{')depth++;
    else if(character===')'||character===']'||character==='}')depth--;
    else if(character===';'&&depth===0)return text.slice(start,i).replace(/\s+/g,' ').trim();
  }
  return text.slice(start).replace(/\s+/g,' ').trim();
};
const sourceCache=new Map();
const testWindow=caseRecord=>{
  if(!caseRecord.source || !fs.existsSync(path.join(root,caseRecord.source))) return null;
  const text=sourceCache.get(caseRecord.source) ?? fs.readFileSync(path.join(root,caseRecord.source),'utf8');
  sourceCache.set(caseRecord.source,text);
  const start=text.indexOf(caseRecord.id);
  if(start<0) return null;
  const ends=['\ntest(', '\nit(', '\ndescribe('].map(token=>text.indexOf(token,start+caseRecord.id.length)).filter(i=>i>=0);
  return text.slice(start,ends.length?Math.min(...ends):text.length);
};
for(const caseRecord of contracts.cases){
  const body=testWindow(caseRecord), assertions=body?[...body.matchAll(assertionPattern)].map(match=>readAssertion(body,match.index)):[];
  const inspected=(body||'').toLowerCase();
  const facets=[];
  if(/\.status\b|statuscode/.test(inspected))facets.push('HTTP status');
  if(/headers?\b|content-type|cache-control|etag/.test(inspected))facets.push('headers');
  if(/\.body\b|\.json\(|content-length|buffer\b/.test(inspected))facets.push('body/bytes');
  if(/writes?|storage|yaml|snapshot|cache/.test(inspected))facets.push('storage');
  if(/calls?|publish|broadcast|emit|send\(/.test(inspected))facets.push('external calls/events');
  const ordering=/order|sequence|before|after|calls\b/.test(inspected)
    ? 'Exact call/order assertions are retained in the listed source expressions.'
    : 'No ordering assertion is represented by this case.';
  const deterministic=/date\b|clock|random|timezone|timer|seed/.test(inspected)
    ? 'The source body supplies the shown deterministic control; normalization remains limited to the case record.'
    : 'No additional deterministic control inferred from this source window.';
  caseRecord.oracle={
    kind: assertions.length?'source-assertion-projection':'reused-or-planned-case',
    expected: assertions.length?assertions:[`Exact named assertion/scenario: ${caseRecord.description}`],
    observableFacets: facets.length?facets:['function/result or scenario outcome named by the case'],
    ordering,
    deterministicControls: deterministic,
    permittedNormalization: caseRecord.normalization
  };
}
contracts.status=contracts.contracts.length+' contract family IDs and current executed cases linked; full per-case/registration catalog remains incomplete';
population.newExecutedCases=contracts.cases.filter(c=>!c.id.startsWith('CASE-EXISTING-'));
emit('test-population.json',population);emit('contracts.json',contracts);
const owners=read('owner-boundaries.json'),graph=read('dependency-ledger.json'),foundation=new Set(owners.foundation.map(f=>f.path));
const edges=graph.edges.filter(e=>foundation.has(e.target));
owners.foundationImpact={incomingEdges:edges.length,distinctConsumers:new Set(edges.map(e=>e.from)).size,externalConsumers:new Set(edges.filter(e=>!foundation.has(e.from)).map(e=>e.from)).size,edges:edges.map(e=>({edge:e.id,consumer:e.from,line:e.line,target:e.target,symbols:e.symbols||[],affectedGate:'complete public replacement and consumer test review before foundation relocation'}))};
emit('owner-boundaries.json',owners);
process.stdout.write(JSON.stringify({contractFamilies:contracts.contracts.length,caseRecords:contracts.cases.length,dedicatedFiles:discovered.length,foundationIncoming:edges.length})+'\n');
