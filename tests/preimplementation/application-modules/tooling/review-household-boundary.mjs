/** Source-only specification: household identity presentation, config translation and browser client. */
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
const owners=read('owner-boundaries.json'),graph=read('dependency-ledger.json'),contracts=read('contracts.json');
const foundation=read('boundary-review.json');
const inputs=new Map();
function source(file){const text=fs.readFileSync(path.join(root,file),'utf8');inputs.set(file,{path:file,sha256:hash(text)});return text;}
function anchor(file,token){const text=source(file),start=text.indexOf(token);assert.ok(start>=0,'Missing household anchor '+file+':'+token);
  return {path:file,line:text.slice(0,start).split('\n').length,token};}
const owner=owners.sharedCapabilities.find(c=>c.id==='household-identity');assert.ok(owner);
const base='capabilities/household-identity';
const port=base+'/server/application/ports/IHouseholdPresentationSource.mjs';
const adapter=base+'/server/adapters/config/ConfigHouseholdPresentationSource.mjs';
const query=base+'/server/application/queries/HouseholdPresentationQuery.mjs';
const factory=base+'/server/composition/createHouseholdIdentityServices.mjs';
const web=base+'/web/rosterClient.mjs';
const publicServer=base+'/public/server/compose.mjs',publicWeb=base+'/public/web/roster-client.mjs';
const newFiles=[{
  path:port,layer:'application',runtime:'server',role:'shared capability application source port',imports:[],
  sourceText:`/** Cached household presentation values; no paths, credentials, auth or disk reload. */
export class IHouseholdPresentationSource {
  getDefaultHouseholdId() { throw new Error('IHouseholdPresentationSource.getDefaultHouseholdId must be implemented'); }
  getTimezone(_householdId) { throw new Error('IHouseholdPresentationSource.getTimezone must be implemented'); }
  getUserIds(_householdId) { throw new Error('IHouseholdPresentationSource.getUserIds must be implemented'); }
  getProfile(_userId) { throw new Error('IHouseholdPresentationSource.getProfile must be implemented'); }
}
`
},{
  path:adapter,layer:'adapter',runtime:'server',role:'config representation translation; real implemented shared port',
  imports:[{specifier:'../../application/ports/IHouseholdPresentationSource.mjs',target:port}],
  sourceText:`import { IHouseholdPresentationSource } from '../../application/ports/IHouseholdPresentationSource.mjs';

export class ConfigHouseholdPresentationSource extends IHouseholdPresentationSource {
  #configService;
  constructor({ configService }) {
    super();
    if (!configService) throw new Error('ConfigHouseholdPresentationSource requires configService');
    this.#configService = configService;
  }
  getDefaultHouseholdId() { return this.#configService.getDefaultHouseholdId(); }
  getTimezone(householdId) { return this.#configService.getHouseholdTimezone?.(householdId); }
  getUserIds(householdId) { return this.#configService.getHouseholdUsers?.(householdId); }
  getProfile(userId) {
    const profile = this.#configService.getUserProfile?.(userId);
    // Preserve short-circuit reads: roster names and confirmation labels differ.
    // This request-local value view is not a cached profile or serialized DTO.
    return {
      get displayName() { return profile?.display_name; },
      get name() { return profile?.name; },
      get groupLabel() { return profile?.group_label; },
    };
  }
}
`
},{
  path:query,layer:'application',runtime:'server',role:'shared household presentation policy over injected source',imports:[],
  sourceText:`export class HouseholdPresentationQuery {
  #source;
  /** @param {{source: import('../ports/IHouseholdPresentationSource.mjs').IHouseholdPresentationSource}} deps */
  constructor({ source }) {
    if (!source) throw new Error('HouseholdPresentationQuery requires source');
    this.#source = source;
  }
  getDefaultHouseholdId() { return this.#source.getDefaultHouseholdId(); }
  // Raw configured timezone: each consuming workflow retains its fallback policy.
  getTimezone(householdId) { return this.#source.getTimezone(householdId); }
  resolveDisplayName(userId) {
    if (!userId) return 'Unknown';
    const profile = this.#source.getProfile(userId);
    return profile?.groupLabel || profile?.displayName || profile?.name
      || userId.charAt(0).toUpperCase() + userId.slice(1);
  }
  getHouseholdUsers(householdId) {
    const usernames = this.#source.getUserIds(householdId) || [];
    return usernames.map(username => {
      const profile = this.#source.getProfile(username);
      return {
        id: username,
        name: profile?.displayName || profile?.name || username.charAt(0).toUpperCase() + username.slice(1),
        // Existing public presentation field, not a raw stored-profile object.
        group_label: profile?.groupLabel || null,
      };
    });
  }
}
`
},{
  path:factory,layer:'composition',runtime:'server',role:'inert capability-local assembly',
  imports:[{specifier:'../adapters/config/ConfigHouseholdPresentationSource.mjs',target:adapter},
    {specifier:'../application/queries/HouseholdPresentationQuery.mjs',target:query}],
  sourceText:`import { ConfigHouseholdPresentationSource } from '../adapters/config/ConfigHouseholdPresentationSource.mjs';
import { HouseholdPresentationQuery } from '../application/queries/HouseholdPresentationQuery.mjs';

export function createHouseholdIdentityServices({ configService }) {
  const source = new ConfigHouseholdPresentationSource({ configService });
  const query = new HouseholdPresentationQuery({ source });
  return {
    householdPresentation: {
      getDefaultHouseholdId: () => query.getDefaultHouseholdId(),
      getTimezone: householdId => query.getTimezone(householdId),
      getHouseholdUsers: householdId => query.getHouseholdUsers(householdId),
      resolveDisplayName: userId => query.resolveDisplayName(userId),
    },
  };
}
`
},{
  path:web,layer:'browser',runtime:'browser',role:'public roster-response transport seam with unchanged compatibility URL',
  imports:[{specifier:'@daylight/platform/web/http',target:'platform/web/lib/api.mjs',symbol:'DaylightAPI',boundary:'existing proposed foundation public entry; complete identity/lock proof still required'}],
  sourceText:`import { DaylightAPI } from '@daylight/platform/web/http';

/** Return the existing bootstrap response promise unchanged; callers consume users. */
export function fetchHouseholdRosterResponse() {
  return DaylightAPI('/api/v1/gratitude/bootstrap');
}
`
},{
  path:publicServer,layer:'composition',runtime:'server',role:'permanent classified composition facade',
  imports:[{specifier:'@daylight-internal/household-identity--server/compose',target:factory}],
  sourceText:`export { createHouseholdIdentityServices } from '@daylight-internal/household-identity--server/compose';\n`
},{
  path:publicWeb,layer:'browser',runtime:'browser',role:'permanent classified browser facade',
  imports:[{specifier:'@daylight-internal/household-identity--web/roster-client',target:web}],
  sourceText:`export { fetchHouseholdRosterResponse } from '@daylight-internal/household-identity--web/roster-client';\n`
}];
for(const file of newFiles){
  Object.assign(file,{owner:owner.id,category:'capability',context:null,rank:null,
    visibility:file.path.startsWith(base+'/public/')?'public facade retaining target classification':'owner-private source',
    sha256:hash(file.sourceText),syntax:'parsed only; never installed or executed'});
  const ast=parse(file.sourceText,{sourceType:'module'});
  const specs=ast.program.body.filter(n=>n.type==='ImportDeclaration'||n.type==='ExportNamedDeclaration'&&n.source).map(n=>n.source.value);
  assert.deepEqual(specs,file.imports.map(i=>i.specifier));
  for(const edge of file.imports.filter(i=>i.specifier.startsWith('.')))
    assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(file.path),edge.specifier)),edge.target);
  assert.equal(fs.existsSync(path.join(root,file.path)),false,'Planned production file exists: '+file.path);
}
assert.ok(newFiles.find(f=>f.path===adapter).sourceText.includes('extends IHouseholdPresentationSource'));
const packageVersion='0.0.0';
const manifests=[{
  path:base+'/public/package.json',content:{name:'@daylight/household-identity',version:packageVersion,private:true,type:'module',
    exports:{'./server/compose':'./server/compose.mjs','./web/roster-client':'./web/roster-client.mjs'},
    dependencies:{'@daylight-internal/household-identity--server':packageVersion,'@daylight-internal/household-identity--web':packageVersion}}
},{
  path:base+'/server/package.json',content:{name:'@daylight-internal/household-identity--server',version:packageVersion,private:true,type:'module',
    exports:{'./compose':'./composition/createHouseholdIdentityServices.mjs'}}
},{
  path:base+'/web/package.json',content:{name:'@daylight-internal/household-identity--web',version:packageVersion,private:true,type:'module',
    exports:{'./roster-client':'./rosterClient.mjs'},dependencies:{'@daylight/platform':packageVersion}}
}];
for(const manifest of manifests){
  manifest.status='exact proposed new manifest, not installed; adopted platform workspace version and whole lock graph must match before execution';
  manifest.sha256=hash(JSON.stringify(manifest.content));assert.equal(fs.existsSync(path.join(root,manifest.path)),false);
  for(const target of Object.values(manifest.content.exports))assert.ok(newFiles.some(f=>f.path===path.posix.join(path.posix.dirname(manifest.path),target)));
}
const household='backend/src/3_applications/gratitude/services/GratitudeHouseholdService.mjs';
const compose='backend/src/5_composition/modules/gratitudeApi.mjs',bootstrap='backend/src/5_composition/bootstrap.mjs',app='backend/src/app.mjs';
const family='frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx',registry='frontend/src/lib/appRegistry.js';
const edits=[],planned=new Map();
function edit(file,before,after,reason){
  const text=planned.get(file)||source(file);assert.equal(text.split(before).length,2,'Missing/nonunique household edit '+file+':'+before);
  edits.push({path:file,afterRelocation:owners.moves.find(m=>m.old===file)?.new||file,at:anchor(file,before),before,after,reason,status:'future protected edit, not applied'});
  planned.set(file,text.replace(before,after));
}
function rename(file,before,after){
  const text=source(file),matches=[...text.matchAll(new RegExp('\\b'+before+'\\b','g'))];assert.ok(matches.length);
  edits.push({path:file,afterRelocation:owners.moves.find(m=>m.old===file)?.new||file,before,after,
    occurrences:matches.map(m=>({offset:m.index,line:text.slice(0,m.index).split('\n').length})),
    reason:'Rename required semantic dependency and its validation/documentation; no old-key fallback',status:'future protected edit, not applied'});
  planned.set(file,text.replace(new RegExp('\\b'+before+'\\b','g'),after));
}
rename(household,'householdDirectory','householdPresentation');
// These edits follow the rename; source anchors use the original spelling explicitly.
function renamedEdit(before,after,reason){
  const text=planned.get(household),actual=before.replaceAll('householdDirectory','householdPresentation');assert.equal(text.split(actual).length,2);
  edits.push({path:household,afterRelocation:owners.moves.find(m=>m.old===household).new,at:anchor(household,before),before:actual,baselineBefore:before,after,reason,status:'future edit following dependency rename'});
  planned.set(household,text.replace(actual,after));
}
renamedEdit("return this.#householdDirectory.timezone?.(householdId) || 'UTC';",
  "return this.#householdPresentation.getTimezone(householdId) || 'UTC';",'Shared query returns raw timezone; Gratitude retains truthy UTC fallback');
renamedEdit('return this.#householdDirectory.defaultHouseholdId();','return this.#householdPresentation.getDefaultHouseholdId();','Same synchronous default-household query');
const original=source(household),ast=parse(original,{sourceType:'module'});
const klass=ast.program.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='ClassDeclaration').declaration;
for(const methodName of ['resolveDisplayName','getHouseholdUsers']){
  const method=klass.body.body.find(n=>n.key?.name===methodName),before=original.slice(method.start,method.end),arg=method.params[0].name;
  renamedEdit(before,`${methodName}(${arg}) {\n    return this.#householdPresentation.${methodName}(${arg});\n  }`,'Delegate reusable presentation policy; no config field interpretation remains in Gratitude');
}
edit(compose,'* @param {Object} config.configService - ConfigService for household lookup',
  '* @param {Object} config.householdPresentation - Bound household presentation queries','Remove private config requirement from product composition');
edit(compose,'    gratitudeServices,\n    configService,','    gratitudeServices,\n    householdPresentation,','Receive shared application query object');
edit(compose,'    householdDirectory: {\n      timezone: (id) => configService.getHouseholdTimezone?.(id),\n      defaultHouseholdId: () => configService.getDefaultHouseholdId(),\n      userIds: (id) => configService.getHouseholdUsers?.(id),\n      userProfile: (id) => configService.getUserProfile?.(id),\n    },',
  '    householdPresentation,','Only installed composition binds identity capability; Gratitude has no config translation');
edit(bootstrap,"import { GratitudeHouseholdService } from '#apps/gratitude/services/GratitudeHouseholdService.mjs';\n",'',
  'Remove confirmed unused private helper import; coordinate with existing Gratitude extraction card, do not add a public helper facade');
assert.equal(source(bootstrap).split('GratitudeHouseholdService').length,3,'The name must occur only as imported symbol and module filename');
edit(app,"import express from 'express';","import express from 'express';\nimport { createHouseholdIdentityServices } from '@daylight/household-identity/server/compose';",'Explicit installed composition import of inert public capability factory');
edit(app,'  v1Routers.gratitude = createGratitudeApiRouter({\n    gratitudeServices,\n    configService,',
  '  const householdIdentityServices = createHouseholdIdentityServices({ configService });\n  v1Routers.gratitude = createGratitudeApiRouter({\n    gratitudeServices,\n    householdPresentation: householdIdentityServices.householdPresentation,',
  'Same installed ConfigService object; one inert assembly at the existing Gratitude binding site');
for(const file of [family,registry]){
  edit(file,'import { DaylightAPI, DaylightMediaPath }','import { DaylightMediaPath }','Remove only now-unused transport symbol; foundation relocation independently changes its module specifier');
  const anchorText=file===family?"import { useMemo, useState, useEffect, useCallback, useRef } from 'react';":"// App icon SVGs (Vite resolves these to hashed URLs)";
  edit(file,anchorText,"import { fetchHouseholdRosterResponse } from '@daylight/household-identity/web/roster-client';\n"+anchorText,'Use deliberate shared browser entry; retain media/avatar helper and product selection logic');
  edit(file,"await DaylightAPI('/api/v1/gratitude/bootstrap')",'await fetchHouseholdRosterResponse()','Same original promise/response/error, URL and arguments through the shared client');
}
edit(family,'// Use the gratitude bootstrap endpoint which returns household users','// Load household users through the shared roster client','Remove endpoint knowledge from the surface');
for(const [file,text] of planned){parse(text,{sourceType:'module',plugins:file.endsWith('.jsx')?['jsx']:[]});}
assert.ok(!planned.get(household).includes('profile?.'));assert.ok(planned.get(household).includes('validateCategory(category)'));
const incoming=graph.edges.filter(e=>e.target===household).map(e=>({edge:e.id,path:e.from,line:e.line,
  disposition:e.from===bootstrap?'remove unused import; no new public helper entry':e.from===compose?'retain owner-private helper import with selected relocation rewrite':'UNREVIEWED'}));
assert.equal(incoming.length,2);assert.ok(incoming.every(e=>e.disposition!=='UNREVIEWED'));
const cases=contracts.cases.filter(c=>c.id.startsWith('CASE-HOUSEHOLD-PROJECTION-')).map(c=>({id:c.id,source:c.source,evidence:c.evidence,baselineResult:c.baselineResult}));
const browserCases=contracts.cases.filter(c=>c.id.startsWith('CASE-GR-FAMILY')||c.id.startsWith('CASE-GR-APP-PARAMS')).map(c=>({id:c.id,source:c.source,evidence:c.evidence,baselineResult:c.baselineResult}));
assert.equal(cases.length,9);assert.equal(browserCases.length,5);assert.ok([...cases,...browserCases].every(c=>c.baselineResult==='passed'));
source('backend/src/1_adapters/identity/ConfigUserDirectory.mjs');source('backend/src/1_adapters/homebot/ConfigHouseholdAdapter.mjs');
source('backend/src/0_system/config/ConfigService.mjs');source('backend/src/4_api/v1/routers/gratitude.mjs');
source('backend/src/0_system/utils/time.mjs');
const httpEntry=foundation.files.find(f=>f.path==='frontend/src/lib/api.mjs');
assert.equal(httpEntry?.entry,'@daylight/platform/web/http');assert.equal(httpEntry.proposedPath,'platform/web/lib/api.mjs');
// Verify that the three selected integration cards compose, not merely parse alone.
// This is an in-memory edit-order proof, never a migrated source tree or build.
const feed=read('feed-boundary.json'),homebot=read('homebot-boundary.json');
const combined=new Map(),combinedEdits=[];
for(const [name,changes] of [['feed-boundary.json',feed.edits],['homebot-boundary.json',homebot.edits],['household-boundary.json',edits]]){
  for(const [index,change] of changes.entries()){
    const text=combined.get(change.path)||source(change.path);let next;
    if(change.occurrences){
      assert.match(change.before,/^[A-Za-z_$][A-Za-z0-9_$]*$/);
      const pattern=new RegExp('\\b'+change.before+'\\b','g');
      assert.equal([...text.matchAll(pattern)].length,change.occurrences.length,'Combined rename count changed: '+name+':'+change.path);
      next=text.replace(pattern,change.after);
    }else{
      assert.equal(text.split(change.before).length,2,'Combined source-edit collision: '+name+':'+change.path);
      next=text.replace(change.before,change.after);
    }
    combined.set(change.path,next);combinedEdits.push({specification:name,index,path:change.path});
  }
}
const combinedFiles=[...combined].map(([file,text])=>{
  parse(text,{sourceType:'module',plugins:file.endsWith('.jsx')?['jsx']:[]});
  return {path:file,sourceSha256:hash(source(file)),plannedSha256:hash(text),syntax:'parsed only, no source file written'};
});
const combinedNewFiles=[...feed.newFiles,...homebot.newFiles,...newFiles].map(f=>({path:f.path,sha256:f.sha256,owner:f.owner,layer:f.layer}));
assert.equal(combinedFiles.length,10);assert.equal(combinedEdits.length,39);assert.equal(combinedNewFiles.length,13);
assert.equal(new Set(combinedNewFiles.map(f=>f.path)).size,13,'Duplicate proposed source authority across boundary cards');
assert.ok(feed.newFiles.some(f=>f.path===homebot.sharedFactory.path&&f.sha256===homebot.sharedFactory.sha256),'Shared Gratitude factory specifications disagree');
const report={schema:'daylight.preimplementation.household-boundary/v1',baseline:owners.baseline,
  status:'Selected exact source/interface/manifest proposal and original-source cases; not implementation, full package adoption or runtime certification',
  owner,newFiles,manifests,edits,incoming,cases,browserCases,
  combinedEditSequence:{order:['IMP-SHARED.02','IMP-SHARED.03.1','IMP-SHARED.03.2'],edits:combinedEdits,files:combinedFiles,newFiles:combinedNewFiles,
    result:'All 39 exact edit groups apply sequentially to ten original files and parse; thirteen new source paths are unique and the shared factory hash agrees.',
    limits:'Only these selected boundary edits; not complete foundation/relocation/import/package/metadata/test-driver or whole migration proof. No candidate code executed.'},
  requiredPackageChanges:{workspaceRoots:owner.facets.map(f=>f.path),consumerDependencies:[{path:'backend/package.json',name:'@daylight/household-identity',version:packageVersion},
    {path:'frontend/package.json',name:'@daylight/household-identity',version:packageVersion}],
    coordination:'IMP-PKG.02 must adopt these exact sibling roots and dependencies in the same reviewed nested-install graph. The new private version is 0.0.0; platform facade must use that compatible workspace version or the exact version field is reviewed before adoption. No root/global install now.',
    remaining:'Owner metadata target schema/commands, README/dev/test targets, complete root lockfile/build/watch/runner projections and native graph proof are still global PRE-4/7 gates; not implicitly completed by these manifests.'},
  returnedInterface:{member:'householdPresentation',layer:'application',runtime:'server',synchronous:true,
    signatures:['getDefaultHouseholdId(): configured value','getTimezone(householdId): configured value without additional UTC fallback',
      'getHouseholdUsers(householdId): ordered Array<{id, name, group_label}>','resolveDisplayName(userId): group label/name/capitalized ID or Unknown'],
    wireFields:'group_label in the outward plain presentation DTO is the existing public field, not permission to expose raw profiles or config representation. Application input uses displayName/name/groupLabel through its source port.',
    narrowSource:'Adapter returns only presentation value accessors, never the raw profile. Lazy getters preserve short-circuit read/error order. Truthy non-string values remain observable; no coercion/deep freeze/security boundary is claimed.'},
  preserve:{
    policies:'Gratitude retains category coercion/validation and timestamp generation/UTC fallback. Homebot and ConfigUserDirectory retain their distinct object-roster, missing-profile and name policies; no universal User service replacement.',
    data:'Same configured roster order, duplicates, holes and raw IDs; no user filtering, sorting, new defaults, writes, reload, memoization or extra profile reads. Each projection sees the current installed cached config state.',
    lifecycle:'One inert source/query assembly at the existing binding point; no construction-time config read, subscription, device/provider activation or disposer. Same installed ConfigService receiver.',
    HTTP:'Router unchanged: request household uses truthiness fallback, bootstrap awaits application bootstrap before user projection, data spread may override users, final _household wins. Original users route stays synchronous and middleware/error handling is unchanged.',
    browser:'fetchHouseholdRosterResponse returns DaylightAPI promise directly. Same no-argument GET to existing bootstrap URL, no async/then wrapper, normalization, retry, cache, selector or new endpoint. Callers still own users||[], labels, avatars, errors and wheel/parameter behavior.',
    clock:'UTC/missing/empty household timezone still reaches nowTs24 with DEFAULT_TIMEZONE, not UTC. Other timezones keep locale formatting; invalid timezone still throws. This is not a time-helper or configurable-timezone repair.'},
  intentionalInternalChanges:['GratitudeHouseholdService requires householdPresentation instead of householdDirectory, including the required-dependency error string; its public helper results remain unchanged.',
    'Gratitude API composition receives the bound query object instead of ConfigService. Invalid/missing ConfigService now fails explicitly when installed identity composition constructs its adapter.',
    'Source-port methods are required internal methods; its config adapter retains the old optional getHouseholdTimezone/getHouseholdUsers/getUserProfile behavior. No optional provider is made mandatory at the config boundary.'],
  negativeControls:[{id:'NEG-IDENTITY-DIRECTORY-SUBSTITUTION',change:'use ConfigUserDirectory.getHouseholdRoster',expectedCase:'CASE-HOUSEHOLD-PROJECTION-USER-DIRECTORY'},
    {id:'NEG-IDENTITY-EAGER-PROFILE',change:'materialize all profile fields before choosing display name',expectedCase:'CASE-HOUSEHOLD-PROJECTION-READ-ORDER'},
    {id:'NEG-IDENTITY-UTC-REPAIR',change:'format UTC fallback as actual UTC',expectedCase:'CASE-HOUSEHOLD-PROJECTION-TIMESTAMP'},
    {id:'NEG-IDENTITY-CACHE',change:'memoize users/name results across config refresh',expectedCase:'CASE-HOUSEHOLD-PROJECTION-RELOAD'},
    {id:'NEG-IDENTITY-BOOTSTRAP-ORDER',change:'project users before awaited bootstrap',expectedCase:'CASE-HOUSEHOLD-PROJECTION-HTTP-ORDER'},
    {id:'NEG-IDENTITY-CLIENT-FALLBACK',change:'convert rejected roster request into empty members',expectedCase:'CASE-GR-FAMILY-ERROR'}].map(n=>({...n,status:'specified, not executed'})),
  limits:['Parsed snippets, exact existing cases and package declarations are not candidate/installation/compiler/native/controller proof.',
    'The browser response seam intentionally preserves the established bootstrap envelope, including unrelated fields; identity clients only consume users and must not make the remaining Gratitude fields into an identity contract.',
    'FamilySelector remains a user-facing surface outside Gratitude; this changes only its shared client import, not its product ownership or full future relocation.',
    'Full shared identity extraction and package readiness require the metadata/test/dev/lock/build gates; no owner rank or layer permission follows from publishing a facade.'],
  inputs:[...inputs.values()],inventoryInputs:['owner-boundaries.json','dependency-ledger.json','contracts.json','boundary-review.json','feed-boundary.json','homebot-boundary.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolchain:{parser:JSON.parse(fs.readFileSync(require.resolve('@babel/parser/package.json'))).version},toolHash:hash(fs.readFileSync(new URL(import.meta.url)))};
emit('household-boundary.json',report);
process.stdout.write(JSON.stringify({newSourceFiles:newFiles.length,newManifests:manifests.length,sourceEdits:edits.length,existingImports:incoming.length,
  projectionCases:cases.length,browserCases:browserCases.length})+'\n');
