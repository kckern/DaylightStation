/** Exact Homebot command plan and household baseline contrasts; no candidate execution. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root,packet,emit} from './census.mjs';
assert.ok(process.env.PRE_TOOLCHAIN_ROOT,'Explicit parser toolchain required');
const require=createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT,'package.json'));
const {parse}=require('@babel/parser'),hash=value=>createHash('sha256').update(value).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const owners=read('owner-boundaries.json'),graph=read('dependency-ledger.json'),contracts=read('contracts.json'),feed=read('feed-boundary.json');
const inputs=new Map();
function source(file){const text=fs.readFileSync(path.join(root,file),'utf8');inputs.set(file,{path:file,sha256:hash(text)});return text;}
function anchor(file,token){const text=source(file),offset=text.indexOf(token);assert.ok(offset>=0,'Missing Homebot anchor '+file+':'+token);
  return {path:file,line:text.slice(0,offset).split('\n').length,token};}
const usecase='backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs';
const container='backend/src/3_applications/homebot/HomeBotContainer.mjs';
const bootstrap='backend/src/5_composition/bootstrap.mjs',app='backend/src/app.mjs';
const existingTest='tests/isolated/flow/homebot/AssignItemToUser.test.mjs';
const port='backend/src/3_applications/homebot/ports/IGratitudeSelectionGateway.mjs';
const adapter='backend/src/1_adapters/homebot/GratitudeSelectionCommandAdapter.mjs';
const newFiles=[{
  path:port,finalDestination:'modules/homebot/server/application/ports/IGratitudeSelectionGateway.mjs',layer:'application',role:'consumer-owned port',imports:[],
  sourceText:`/** Homebot's batch selection command; no storage or publication responsibilities. */
export class IGratitudeSelectionGateway {
  /** @returns {Promise<Array>} Existing batch result; errors propagate without retry. */
  addSelections(_householdId, _category, _userId, _items, _timestamp) {
    throw new Error('IGratitudeSelectionGateway.addSelections must be implemented');
  }
}
`
},{
  path:adapter,finalDestination:'modules/homebot/server/adapters/gratitude/GratitudeSelectionCommandAdapter.mjs',layer:'adapter',role:'consumer-owned injected command bridge',
  imports:[{specifier:'#apps/homebot/ports/IGratitudeSelectionGateway.mjs',target:port,symbol:'IGratitudeSelectionGateway',
    finalSpecifier:'../../application/ports/IGratitudeSelectionGateway.mjs'}],
  sourceText:`import { IGratitudeSelectionGateway } from '#apps/homebot/ports/IGratitudeSelectionGateway.mjs';

/** Implements Homebot's port using the Gratitude command supplied by composition. */
export class GratitudeSelectionCommandAdapter extends IGratitudeSelectionGateway {
  #addSelections;

  /** @param {{addSelections: Function}} config */
  constructor({ addSelections }) {
    super();
    if (typeof addSelections !== 'function') throw new Error('GratitudeSelectionCommandAdapter requires addSelections');
    this.#addSelections = addSelections;
  }

  /** Return the command's result unchanged; no extra await, retry, catch or event. */
  addSelections(householdId, category, userId, items, timestamp) {
    return this.#addSelections(householdId, category, userId, items, timestamp);
  }
}
`
}];
for(const file of newFiles){
  Object.assign(file,{owner:'homebot',category:'product',runtime:'server',context:null,rank:null,visibility:'owner-private; no public facade',
    stage:'Gratitude rehearsal retains Homebot in its current source tree; later Homebot relocation moves this single implementation to finalDestination, not a compatibility copy'});
  const ast=parse(file.sourceText,{sourceType:'module'});file.sha256=hash(file.sourceText);file.syntax='parsed only; not executed';
  assert.deepEqual(ast.program.body.filter(n=>n.type==='ImportDeclaration').map(n=>n.source.value),file.imports.map(i=>i.specifier));
  assert.equal(fs.existsSync(path.join(root,file.path)),false);assert.equal(fs.existsSync(path.join(root,file.finalDestination)),false);
}
assert.ok(newFiles[1].sourceText.includes('extends IGratitudeSelectionGateway'));
assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(newFiles[1].finalDestination),newFiles[1].imports[0].finalSpecifier)),newFiles[0].finalDestination);
const edits=[],candidateText=new Map();
function edit(file,before,after,reason){
  const text=candidateText.get(file)||source(file);assert.equal(text.split(before).length,2,'Missing/nonunique edit '+file+':'+before);
  edits.push({path:file,at:anchor(file,before),before,after,reason,status:'future protected edit; not applied'});
  candidateText.set(file,text.replace(before,after));
}
function rename(file,before,after,reason){
  const text=source(file),matches=[...text.matchAll(new RegExp('\\b'+before+'\\b','g'))];assert.ok(matches.length>0);
  edits.push({path:file,before,after,occurrences:matches.map(m=>({offset:m.index,line:text.slice(0,m.index).split('\n').length})),
    replacement:'all exact word-boundary occurrences, including constructor error string and dependency documentation',reason,status:'future protected edit; not applied'});
  candidateText.set(file,text.replace(new RegExp('\\b'+before+'\\b','g'),after));
}
rename(usecase,'gratitudeService','gratitudeSelectionGateway','Explicit consumer-owned dependency; preserve addSelections invocation and entire workflow');
rename(container,'gratitudeService','gratitudeSelectionGateway','Pass abstract gateway to same lazy cached usecase; do not import adapter here');
rename(existingTest,'gratitudeService','gratitudeSelectionGateway','Update only internal dependency key/error name in the retained original test; keep behavior assertions and mock method unchanged');
edit(usecase,'- Service for saving gratitude items','- Homebot-owned selection command gateway','Document the semantic dependency');
edit(container,'- GratitudeService instance','- Homebot-owned selection command gateway','Remove concrete service type from application dependency documentation');
edit(bootstrap,"import { HomeBotContainer } from '#apps/homebot/HomeBotContainer.mjs';",
  "import { HomeBotContainer } from '#apps/homebot/HomeBotContainer.mjs';\nimport { GratitudeSelectionCommandAdapter } from '#adapters/homebot/GratitudeSelectionCommandAdapter.mjs';",
  'Only composition imports and constructs the concrete consumer bridge; no adapter-barrel expansion');
edit(bootstrap,'* @param {Object} config.gratitudeService - GratitudeService instance',
  '* @param {Function} config.addGratitudeSelections - Bound Gratitude batch command','Narrow Homebot factory input');
edit(bootstrap,'    aiGateway,\n    gratitudeService,\n    configService,','    aiGateway,\n    addGratitudeSelections,\n    configService,','Destructure the bound public operation');
edit(bootstrap,'  // Create homebot container with all dependencies\n  const homebotContainer = new HomeBotContainer({',
  '  const gratitudeSelectionGateway = new GratitudeSelectionCommandAdapter({\n    addSelections: addGratitudeSelections,\n  });\n\n  // Create homebot container with all dependencies\n  const homebotContainer = new HomeBotContainer({',
  'Construct one bridge per existing Homebot factory invocation; no calls or subscriptions at construction');
edit(bootstrap,'    messagingGateway: telegramAdapter,\n    aiGateway,\n    gratitudeService,',
  '    messagingGateway: telegramAdapter,\n    aiGateway,\n    gratitudeSelectionGateway,','Inject bridge, preserve other factory inputs/output identities');
edit(app,'  const homebotServices = createHomebotServices({\n    telegramAdapter: homebotTelegramAdapter,\n    aiGateway: homebotAiGateway,\n    gratitudeService: gratitudeServices.gratitudeService,',
  '  const homebotServices = createHomebotServices({\n    telegramAdapter: homebotTelegramAdapter,\n    aiGateway: homebotAiGateway,\n    addGratitudeSelections: gratitudeServices.gratitudeCommands.addSelections,',
  'Bind only public returned command; preserve installed service instance, activation order and source:homebot publication site');
for(const text of candidateText.values())parse(text,{sourceType:'module'});
const factory=feed.newFiles.find(f=>f.path==='modules/gratitude/server/composition/createGratitudeServices.mjs');
assert.ok(factory?.sourceText.includes('gratitudeService.addSelections(householdId, category, userId, items, timestamp)'));
assert.ok(factory.sourceText.includes('return { gratitudeStore, gratitudeService, gratitudeQueries, gratitudeCommands }'));
const operation=owners.publicOperations.find(o=>o.id==='gratitude.add-selections');assert.ok(operation);
assert.equal(owners.publicEntries.some(e=>e.entry==='@daylight/gratitude/server/commands'),false);
const incoming=graph.edges.filter(e=>[usecase,container].includes(e.target)).map(e=>({edge:e.id,path:e.from,target:e.target,line:e.line,specifier:e.specifier,
  disposition:e.from===existingTest?'same original test import/behavior; dependency key and validation message updated by exact rename':
    e.from===bootstrap?'same retained container import; add bridge construction and narrow factory input':
    e.from===container?'same usecase import and cached lifetime; injected dependency key rename':
    e.from.endsWith('/index.mjs')?'retain re-export unchanged during Gratitude rehearsal; not a new public package surface':'UNREVIEWED'}));
assert.equal(incoming.length,9);assert.ok(incoming.every(e=>e.disposition!=='UNREVIEWED'));
for(const file of new Set(incoming.map(e=>e.path)))source(file);
const cases=contracts.cases.filter(c=>c.id.startsWith('CASE-GR-HOMEBOT')).map(c=>({id:c.id,source:c.source,evidence:c.evidence,baselineResult:c.baselineResult}));
const projectionCases=contracts.cases.filter(c=>['CASE-HOUSEHOLD-PROJECTION-NAMES','CASE-HOUSEHOLD-PROJECTION-DEFAULTS','CASE-HOUSEHOLD-PROJECTION-INVALID'].includes(c.id)).map(c=>({id:c.id,source:c.source,evidence:c.evidence,baselineResult:c.baselineResult}));
assert.equal(cases.length,11);assert.equal(projectionCases.length,3);assert.ok([...cases,...projectionCases].every(c=>c.baselineResult==='passed'));
const household='backend/src/3_applications/gratitude/services/GratitudeHouseholdService.mjs';
const householdAdapter='backend/src/1_adapters/homebot/ConfigHouseholdAdapter.mjs';
const report={schema:'daylight.preimplementation.homebot-boundary/v1',baseline:owners.baseline,
  status:'Exact command specification and original-source baseline proof; household extraction specified separately in household-boundary.json; no candidate executed',
  operation,newFiles,sharedFactory:{specification:'feed-boundary.json',path:factory.path,sha256:factory.sha256,
    delta:'Adds gratitudeCommands.addSelections on the same service instance; canonical full planned source in Feed specification, not a second factory'},
  edits,incoming,cases,projectionCases,
  anchors:[anchor(usecase,'const state = await'),anchor(usecase,'const householdId ='),anchor(usecase,'await this.#gratitudeService.addSelections('),
    anchor(usecase,'const displayName ='),anchor(usecase,'this.#websocketBroadcast({'),anchor(usecase,'await this.#conversationStateStore.delete('),
    anchor('backend/src/3_applications/gratitude/services/GratitudeService.mjs','async addSelections('),
    anchor('backend/src/3_applications/gratitude/services/GratitudeService.mjs','// Check for duplicates'),
    anchor('backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs',"if (data.startsWith('user:'))"),
    anchor(household,'resolveDisplayName(userId)'),anchor(household,'getHouseholdUsers(householdId)'),anchor(household,'validateCategory(category)'),
    anchor(householdAdapter,'async getMembers('),anchor(householdAdapter,'async getMemberDisplayName('),
    anchor('backend/src/0_system/config/ConfigService.mjs','getHouseholdUsers(householdId = null)'),
    anchor('backend/src/5_composition/modules/gratitudeApi.mjs','householdDirectory: {')],
  preserve:{
    command:'Same five positional arguments, array identity, bound original service receiver and returned promise/entity/error identity. No wrapper async, mapping, category/duplicate validation, transfer, retry, transaction or publication.',
    batch:'Original addSelections differs from addSelection: no duplicate lookup or option removal, unchanged category, sequential per-item writes and potentially partial completion. False datastore results do not stop it; retry may repeat earlier items.',
    workflow:'get state -> get default household -> generate timestamp -> await save -> await optional display -> synchronous unawaited broadcast -> await message update -> await state delete. Existing returns/logs/error boundaries unchanged.',
    early:'Missing state/items updates message and returns failure without save/delete. Save/timestamp failure updates message and returns failure; failure of that update rejects. Household/state lookup and post-save failures reject without compensation.',
    message:'responseContext, when supplied directly, receives two update arguments and its own receiver. Gateway fallback receives conversationId/messageId/text. Router assignment callback still forwards only conversationId/messageId/username.',
    values:'category||gratitude for save/event, original raw category in result; exact hopes label only for lowercase hopes. Explicit timezone including UTC uses locale format; omitted timezone uses existing nowTs24. Name query stays (null, username), optional falsy label falls back to username.',
    lifetime:'Same installed GratitudeService used by HTTP and command. One inert bridge per Homebot factory; same lazily cached AssignItemToUser instance. No new routes/events/listeners/jobs/dependencies or independent service instance.'},
  intentionalInternalChanges:['AssignItemToUser/HomeBotContainer dependency key becomes gratitudeSelectionGateway; missing-dependency error string changes accordingly.',
    'createHomebotServices accepts addGratitudeSelections instead of the broad service; invalid operation is rejected by bridge constructor at factory time. Existing lazy usecase validation remains. Valid installed wiring is unchanged.',
    'Gratitude factory returns an additional gratitudeCommands property. No unused commands package subentry or broad service injection into Homebot remains.'],
  householdContrasts:[
    {aspect:'name',gratitude:'roster display_name/name/capitalized ID; confirmation group_label first; no profile lookup for falsy confirmation user',homebot:'same label preference for strings, but always profile lookup even null user; roster has distinct userId/displayName/groupLabel/group fields'},
    {aspect:'timezone',gratitude:'optional directory method then truthy fallback UTC',homebot:'required config method; returns configured value including empty string, no extra UTC fallback'},
    {aspect:'membership',gratitude:'optional ID provider, preserves order/duplicates; assumes string fallback and can throw for object roster entries',homebot:'required provider, accepts object username/userId/name variants; missing ID fallback Unknown'},
    {aspect:'cache',gratitude:'reprojects supplied directory each call; no own cache',homebot:'reprojects same installed ConfigService object each call; no own cache; not fresh disk reads'},
    {aspect:'category',gratitude:'String(category||empty).toLowerCase without trim then service validation; remains product-owned',homebot:'command forwards nonempty category unchanged; must not acquire Gratitude HTTP category policy'}],
  nextControls:[{id:'NEG-HOMEBOT-EARLY-BROADCAST',change:'broadcast before awaited batch completes',expectedCase:'CASE-GR-HOMEBOT-ORDER'},
    {id:'NEG-HOMEBOT-SINGLE-ITEM',change:'replace batch with repeated addSelection',expectedCase:'CASE-GR-HOMEBOT-BATCH'},
    {id:'NEG-HOMEBOT-CLEAR-FAILURE',change:'clear state after failed batch',expectedCase:'CASE-GR-HOMEBOT-BATCH-PARTIAL'},
    {id:'NEG-HOMEBOT-AWAIT-BROADCAST',change:'await broadcast result',expectedCase:'CASE-GR-HOMEBOT-BROADCAST-SYNC'}].map(c=>({...c,status:'specified, not executed'})),
  limits:['Baseline cases and parsed source specifications do not certify candidate package resolution, controller activation, direct adapter or factory execution.',
    'Three initial household contrasts are retained here; the complete selected presentation/source/client design and expanded cases are in household-boundary.json. Native extraction proof remains separate.',
    'Private original service result types are observable local entities, not new serialized DTOs or a public domain class export.',
    'New Homebot files start in the retained Homebot owner for Gratitude rehearsal and must move once with that owner before the final coordinated cutover; no legacy directory or dual implementation.'],
  inputs:[...inputs.values()],inventoryInputs:['owner-boundaries.json','dependency-ledger.json','contracts.json','feed-boundary.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolchain:{parser:JSON.parse(fs.readFileSync(require.resolve('@babel/parser/package.json'))).version},toolHash:hash(fs.readFileSync(new URL(import.meta.url)))};
emit('homebot-boundary.json',report);
process.stdout.write(JSON.stringify({newPrivateFiles:newFiles.length,sourceEdits:edits.length,existingImportEdges:incoming.length,baselineCommandCases:cases.length,projectionCases:projectionCases.length})+'\n');
