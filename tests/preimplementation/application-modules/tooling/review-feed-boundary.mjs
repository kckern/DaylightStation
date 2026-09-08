/** Specify the Feed/Gratitude seam from source; never evaluate either application. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root,packet,emit} from './census.mjs';
assert.ok(process.env.PRE_TOOLCHAIN_ROOT,'Explicit parser toolchain required');
const req=createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT,'package.json'));
const {parse}=req('@babel/parser');
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const graph=read('dependency-ledger.json'),owners=read('owner-boundaries.json'),contracts=read('contracts.json');
const inputs=new Map();
function source(file){const text=fs.readFileSync(path.join(root,file),'utf8');inputs.set(file,{path:file,sha256:hash(text)});return text;}
function anchor(file,token){const text=source(file),offset=text.indexOf(token);assert.ok(offset>=0,'Missing Feed boundary anchor: '+file+':'+token);
  return {path:file,line:text.slice(0,offset).split('\n').length,token};}
const feed='backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs';
const feedPort='backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs';
const factory='modules/gratitude/server/composition/createGratitudeServices.mjs';
const applicationPort='modules/gratitude/server/application/ports/IGratitudeQuoteSource.mjs';
const query='modules/gratitude/server/application/queries/GratitudeSelectionQuery.mjs';
const reader='modules/gratitude/server/adapters/yaml/YamlGratitudeQuoteSource.mjs';
const newFiles=[{
  path:applicationPort,owner:'gratitude',layer:'application',role:'port',imports:[],
  sourceText:`/** Synchronous request-local quote view; no storage-path or raw-row API. */
export class IGratitudeQuoteSource {
  readSelectionQuotes() {
    throw new Error('IGratitudeQuoteSource.readSelectionQuotes must be implemented');
  }
}
`
},{
  path:reader,owner:'gratitude',layer:'adapter',role:'read-only YAML translation implementing application port',
  imports:[{specifier:'../../application/ports/IGratitudeQuoteSource.mjs',target:applicationPort,symbol:'IGratitudeQuoteSource'}],
  sourceText:`import { IGratitudeQuoteSource } from '../../application/ports/IGratitudeQuoteSource.mjs';

export class YamlGratitudeQuoteSource extends IGratitudeQuoteSource {
  #dataService;

  constructor({ dataService }) {
    super();
    if (!dataService) throw new Error('YamlGratitudeQuoteSource requires dataService');
    this.#dataService = dataService;
  }

  readSelectionQuotes() {
    const data = this.#dataService.household.read('gratitude/selections.gratitude.yml');
    if (!data || !Array.isArray(data)) return null;
    // Iterate and inspect fields only when the consumer did before extraction.
    return {
      *[Symbol.iterator]() {
        for (const entry of data) {
          yield {
            get text() {
              return entry.item?.text || (typeof entry.item === 'string' ? entry.item : null) || entry.text || '';
            },
            get userId() { return entry.userId || null; },
            get datetime() { return entry.datetime; },
          };
        }
      },
    };
  }
}
`
},{
  path:query,owner:'gratitude',layer:'application',role:'query over injected application port',imports:[],
  sourceText:`export class GratitudeSelectionQuery {
  #quoteSource;

  /** @param {{quoteSource: import('../ports/IGratitudeQuoteSource.mjs').IGratitudeQuoteSource}} config */
  constructor({ quoteSource }) { this.#quoteSource = quoteSource; }

  readSelectionQuotes() { return this.#quoteSource.readSelectionQuotes(); }
}
`
},{
  path:factory,owner:'gratitude',layer:'composition',role:'expand IMP-SHARED.01 planned factory, not a second factory',
  imports:[
    {specifier:'../adapters/yaml/YamlGratitudeDatastore.mjs',target:'modules/gratitude/server/adapters/yaml/YamlGratitudeDatastore.mjs',symbol:'YamlGratitudeDatastore'},
    {specifier:'../application/services/GratitudeService.mjs',target:'modules/gratitude/server/application/services/GratitudeService.mjs',symbol:'GratitudeService'},
    {specifier:'../adapters/yaml/YamlGratitudeQuoteSource.mjs',target:reader,symbol:'YamlGratitudeQuoteSource'},
    {specifier:'../application/queries/GratitudeSelectionQuery.mjs',target:query,symbol:'GratitudeSelectionQuery'}],
  sourceText:`import { YamlGratitudeDatastore } from '../adapters/yaml/YamlGratitudeDatastore.mjs';
import { GratitudeService } from '../application/services/GratitudeService.mjs';
import { YamlGratitudeQuoteSource } from '../adapters/yaml/YamlGratitudeQuoteSource.mjs';
import { GratitudeSelectionQuery } from '../application/queries/GratitudeSelectionQuery.mjs';

export function createGratitudeServices(config) {
  const { dataService, logger = console } = config;
  const gratitudeStore = new YamlGratitudeDatastore({ dataService, logger });
  const gratitudeService = new GratitudeService({ store: gratitudeStore });
  const quoteSource = new YamlGratitudeQuoteSource({ dataService });
  const selectionQuery = new GratitudeSelectionQuery({ quoteSource });
  const gratitudeQueries = { readSelectionQuotes: () => selectionQuery.readSelectionQuotes() };
  const gratitudeCommands = {
    addSelections: (householdId, category, userId, items, timestamp) =>
      gratitudeService.addSelections(householdId, category, userId, items, timestamp),
  };
  return { gratitudeStore, gratitudeService, gratitudeQueries, gratitudeCommands };
}
`
}];
for(const file of newFiles){
  Object.assign(file,{category:'product',runtime:'server',context:null,rank:null,
    visibility:file.path===factory?'private source; factory exposed only by approved composition entry':'owner-private, no public package subentry'});
  if(file.path===query)file.portDependencies=[{target:applicationPort,mechanism:'injected port with JSDoc type reference; no runtime concrete-adapter import'}];
  const ast=parse(file.sourceText,{sourceType:'module'});
  file.sha256=hash(file.sourceText);file.syntax='parsed, not executed';
  const imports=ast.program.body.filter(n=>n.type==='ImportDeclaration');
  assert.deepEqual(imports.map(n=>n.source.value),file.imports.map(i=>i.specifier));
  for(const edge of file.imports)assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(file.path),edge.specifier)),edge.target);
  assert.equal(fs.existsSync(path.join(root,file.path)),false,'Planned production file already exists; revisit baseline');
}
assert.ok(newFiles.find(f=>f.path===reader).sourceText.includes('extends IGratitudeQuoteSource'));
const edits=[];
function edit(file,before,after,reason){
  const text=source(file);assert.equal(text.split(before).length,2,'Non-unique/missing future edit '+file+':'+before);
  edits.push({path:file,at:anchor(file,before),before,after,reason,status:'future protected-source edit; not applied'});
}
edit(feed,'Reads gratitude selections from DataService and normalizes to FeedItem shape.',
  'Consumes Gratitude quote views and assembles the Feed-owned bundle.','Remove stale storage claim');
edit(feed,'#dataService;','#readGratitudeQuotes;','Hold semantic operation, not a datastore');
edit(feed,'constructor({ dataService, userService, logger = console })',
  'constructor({ readGratitudeQuotes, userService, logger = console })','Intentional internal constructor contract change, no dual fallback');
edit(feed,"if (!dataService) throw new Error('GratitudeFeedAdapter requires dataService');",
  "if (typeof readGratitudeQuotes !== 'function') throw new Error('GratitudeFeedAdapter requires readGratitudeQuotes');",'Fail missing new dependency during composition');
edit(feed,'this.#dataService = dataService;','this.#readGratitudeQuotes = readGratitudeQuotes;','Capture function once without invoking during construction');
edit(feed,"// Must include .yml explicitly — dotted filename confuses DataService.ensureExtension()\n      const data = this.#dataService.household.read('gratitude/selections.gratitude.yml');",
  'const data = this.#readGratitudeQuotes();','Synchronous one-read operation; no extra await or eager iteration');
edit(feed,'if (!data || !Array.isArray(data)) return [];','if (data === null) return [];','Reader owns absence/non-array normalization; iterable empty array still yields one empty bundle');
edit(feed,"const text = entry.item?.text || (typeof entry.item === 'string' ? entry.item : null) || entry.text || '';",
  'const text = entry.text;','Defer legacy interpretation until this selected row is mapped');
edit(feed,'const userId = entry.userId || null;','const userId = entry.userId;','Reader owns stored userId interpretation; Feed still owns group-label lookup');
edit('backend/src/app.mjs','const gratitudeAdapter = new GratitudeFeedAdapter({\n      dataService,',
  'const gratitudeAdapter = new GratitudeFeedAdapter({\n      readGratitudeQuotes: gratitudeServices.gratitudeQueries.readSelectionQuotes,',
  'Installed composition binds the public returned operation; existing userService/logger/activation unchanged');
let plannedFeed=source(feed);for(const e of edits.filter(e=>e.path===feed))plannedFeed=plannedFeed.replace(e.before,e.after);
parse(plannedFeed,{sourceType:'module'});assert.ok(!plannedFeed.includes('selections.gratitude.yml'));
assert.ok(plannedFeed.includes('extends IFeedSourceAdapter'));
const incoming=graph.edges.filter(e=>e.target===feed).map(e=>({edge:e.id,path:e.from,line:e.line,specifier:e.specifier,
  disposition:e.from==='backend/src/app.mjs'?'retain dynamic import and Feed ownership; change constructor injection only':
    e.from==='tests/isolated/adapter/feed/AdapterProvides.test.mjs'?'retain unchanged prototype-only provides test; it never calls the constructor':'UNREVIEWED'}));
assert.equal(incoming.length,2);assert.ok(incoming.every(e=>e.disposition!=='UNREVIEWED'));
source('tests/isolated/adapter/feed/AdapterProvides.test.mjs');
const cases=contracts.cases.filter(c=>c.id.startsWith('CASE-GR-FEED')).map(c=>({id:c.id,source:c.source,evidence:c.evidence,baselineResult:c.baselineResult}));
assert.equal(cases.length,12,'Review the exact Feed baseline case population');assert.ok(cases.every(c=>c.baselineResult==='passed'));
const operation=owners.publicOperations?.find(o=>o.id==='gratitude.read-selection-quotes');
assert.ok(operation,'Missing selected operation in owner boundaries');
assert.equal(owners.publicEntries.some(e=>e.entry==='@daylight/gratitude/server/queries'),false,'Do not publish unused query module');
const report={schema:'daylight.preimplementation.feed-boundary/v1',baseline:owners.baseline,
  status:'Exact selected boundary/source edits and baseline oracles; no candidate or protected change executed',
  operation,newFiles,edits,incoming,cases,
  anchors:[anchor(feed,'async fetchItems(query, _username)'),anchor(feed,'const limit ='),anchor(feed,'const shuffled ='),anchor(feed,'const items = picked.map'),
    anchor(feed,'const latestTs ='),anchor(feed,"this.#logger.warn?.('gratitude.adapter.error'"),
    anchor(feedPort,'async fetchPage('),anchor(feedPort,'get supportsMarkRead()'),
    anchor('backend/src/5_composition/bootstrap.mjs','export function createGratitudeServices(config)'),
    anchor('backend/src/app.mjs','const gratitudeServices = createGratitudeServices({'),
    anchor('frontend/src/modules/Feed/Scroll/cards/bodies/GratitudeBody.jsx','export default')],
  preserve:{
    ownership:'Gratitude owns source/legacy interpretation; Feed owns limit/random sort/slice, user display, selected timestamp comparison, bundle IDs/tier/priority/meta and warn fallback.',
    timing:'Read once synchronously before query.limit. No await inserted. Iterate only at existing spread; access text/userId during selected mapping, datetime during the later reduction. No pre-validation of unselected rows.',
    rows:'Legacy nested/string/top-level truthiness and non-string values retained. Null/undefined/sparse selected rows retain original item-access TypeError message; do not eagerly filter or wrap errors.',
    lifetime:'Each call owns a read result in memory, not an open stream or cache. Iteration/field access performs no extra disk reads. Same boot DataService instance, default household and omitted username preserved.',
    sideEffects:'No writes, HTTP, new events, jobs or provider activation. Feed remains sole warning site; a throwing logger can still reject fetchItems.',
    inherited:'Existing IFeedSourceAdapter inheritance, sourceType/provides, fetchPage null cursor, getDetail null and no-op markRead remain unchanged.',
    interfaceChange:'Constructor changes dataService to readGratitudeQuotes with explicit new validation error; canonical factory adds gratitudeQueries and the separately specified Homebot gratitudeCommands operation but preserves existing store/service objects. These internal wiring changes are intentional and enumerated, not public HTTP/data changes.'},
  limits:['Syntax and baseline cases do not prove the planned implementation or actual Node package resolution.',
    'The read view is a local synchronous iterable with lazy properties, not a JSON DTO, event payload or new HTTP API. Do not serialize/materialize it before Feed selection.',
    'Synthetic getter/sparse-row cases expose ordering mechanisms; ordinary persisted YAML has no JavaScript getters.',
    'Candidate shared-root, full factory/auth/controller, frontend render and actual concurrency/rollback proof remain future gates.'],
  inputs:[...inputs.values()],inventoryInputs:['dependency-ledger.json','owner-boundaries.json','contracts.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolchain:{parser:JSON.parse(fs.readFileSync(req.resolve('@babel/parser/package.json'))).version},toolHash:hash(fs.readFileSync(new URL(import.meta.url)))};
emit('feed-boundary.json',report);
process.stdout.write(JSON.stringify({newPrivateFiles:3,expandedPlannedFactory:1,sourceEdits:edits.length,existingConsumers:incoming.length,baselineCases:cases.length,operation:operation.id})+'\n');
