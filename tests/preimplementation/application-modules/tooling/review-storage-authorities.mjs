/** Source-only storage authority review. Never load private records or application modules. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root,packet,emit} from './census.mjs';
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const graph=read('dependency-ledger.json'),owners=read('owner-boundaries.json'),ledger=read('source-ledger.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),inputs=new Map();
const contents=new Map();
function source(file){
  if(!contents.has(file)){
    const text=fs.readFileSync(path.join(root,file),'utf8'); contents.set(file,text);
    inputs.set(file,{path:file,sha256:hash(text)});
  }
  return contents.get(file);
}
function at(file,token){
  const text=source(file),offset=text.indexOf(token);assert.ok(offset>=0,'Missing authority anchor: '+file+':'+token);
  return {path:file,line:text.slice(0,offset).split('\n').length,anchor:token};
}
const io='backend/src/0_system/utils/FileIO.mjs',data='backend/src/1_adapters/persistence/files/DataService.mjs';
const config='backend/src/0_system/config/ConfigService.mjs',loader='backend/src/0_system/config/configLoader.mjs';
const store='backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs',feed='backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs';
const admin='backend/src/1_adapters/persistence/yaml/YamlAdminConfigStore.mjs',editor='backend/src/3_applications/admin/YamlConfigFileService.mjs';
const registry='shared/contracts/householdConfig.mjs';
const profileStore='backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs';
const profileWriter='backend/src/3_applications/fitness/fingerprintProfileWriter.mjs';
const householdAdmin='backend/src/3_applications/admin/HouseholdAdminService.mjs';
const authAccounts='backend/src/1_adapters/auth/DataServiceAuthAccountRepository.mjs';
const userDirectory='backend/src/1_adapters/identity/ConfigUserDirectory.mjs';
const primitiveConsumers=graph.edges.filter(e=>e.target===io).map(e=>({edge:e.id,path:e.from,line:e.line,symbols:e.symbols||[]}));
const yamlCodec={implementation:at(io,'export function saveYamlToPath('),read:at(io,'export function loadYamlFromPath('),
  serialization:'js-yaml; dump lineWidth -1; DataService also supplies quotingType double quote',
  errorPolicy:'loadYamlFromPath catches read/parse errors as null; DataService collapses falsy values to null and returns false on caught write failure',
  atomicity:'Synchronous whole-file in-place write, no lock or read-modify-write transaction',
  modes:'No explicit mode: existing in-place mode retained; newly created files use process umask'};
const authorities=[];
for(const [id,scope,resolver,pathRule,scopeRule] of [
  ['USER','user','#createUserScope()','<dataDir>/users/<username>/<relativePath>','Explicit username or default head of household; shared user tree, not nested below household'],
  ['HOUSEHOLD','household','#createHouseholdScope()','ConfigService.getHouseholdPath(relativePath, householdId)','Explicit/default household; _folderName or household ID; unknown household throws'],
  ['SYSTEM','system','#createSystemScope()','<dataDir>/system/<relativePath>','Global system data, not household data'],
  ['CONTENT','content','#createContentScope()','<dataDir>/content/<relativePath>','Shared durable content, not household or media tree']]) {
  authorities.push({id:'STORE-DATA-'+id,namespace:scope,pathRule,scope:scopeRule,
    resolver:at(data,resolver),writers:[{path:data,operation:scope+'.write'}],readers:[{path:data,operation:scope+'.read'}],
    codec:yamlCodec,cache:'Every read rereads disk; resolveDir does not append an extension',
    extension:'resolvePath adds .yml only when path.extname is empty; dotted basename is already an extension',
    containment:'These scope helpers are not general authorization/realpath containment gates; keep caller validation distinct',
    cases:id==='HOUSEHOLD'?['CASE-GR-DISK-PATHS','CASE-GR-DISK-FRESH','CASE-GR-DISK-READ-ERROR','CASE-GR-DISK-WRITE-ERROR']:[]});
}
authorities.push({id:'STORE-GR-ARRAYS',namespace:'gratitude/{options,selections,discarded}.{gratitude,hopes}.yml',
  resolver:at(store,'#readArray('),scope:'Explicit household through DataService; Feed reads default household and ignores supplied username',
  writers:[at(store,'#writeArray(')],readers:[at(store,'#readArray('),at(feed,"this.#dataService.household.read('gratitude/selections.gratitude.yml')")],
  codec:yamlCodec,cache:'No array cache; datastore coerces non-array to []; Feed distinguishes absent/non-array from []',
  payload:'Stored selected record id/userId/item/datetime/printed; Feed also accepts legacy nested/string/top-level text after random selection',
  failure:'Datastore ignores false returned by DataService.write. Multi-file transfers/restores have no transaction or rollback.',
  proposedReadBoundary:'DEC-FEED-QUERY / feed-boundary.json: move only Feed legacy read/interpretation into Gratitude-owned YamlGratitudeQuoteSource, through an application port/query and returned composition operation. Retain same DataService/default household, file key and lazy selected-row timing; no new writer or data migration.',
  cases:['CASE-GR-DISK-SELECTION','CASE-GR-FEED-EMPTY','CASE-GR-FEED-BADROW','CASE-GR-FEED-LIMIT']});
authorities.push({id:'STORE-GR-SNAPSHOTS',namespace:'gratitude/snapshots/<wall-clock>_<UUID>.yml',
  resolver:at(store,'#getSnapshotDir('),scope:'Household resolvePath with its appended .yml removed to obtain directory',
  writers:[at(store,'async saveSnapshot(')],readers:[at(store,'async listSnapshots('),at(store,'async loadSnapshot(')],
  codec:{read:at(io,'export function loadYamlSafe('),write:at(io,'export function saveYaml('),serialization:'js-yaml; lineWidth -1; .yml unless already .yml/.yaml'},
  cache:'Directory/read on demand. Listing includes malformed files with fallback metadata; descending filename order is not valid-payload filtering.',
  selection:'loadSnapshot matches the first filename substring, not stored id; unknown/omitted ID selects the latest name. A malformed selected file returns null without trying older valid files. Added file metadata is not persisted.',
  atomicity:'In-place file write; restore writes included arrays separately; no snapshot/restore transaction',modes:yamlCodec.modes,
  cases:['CASE-GR-HTTP-11','CASE-GR-HTTP-12','CASE-GR-HTTP-13','CASE-GR-SNAPSHOT-EMPTY','CASE-GR-SNAPSHOT-FILES']});
authorities.push({id:'STORE-APP-CONFIG',namespace:'<householdFolder>/<registered-app-path>.yml|.yaml',
  resolver:at(config,'getHouseholdAppConfigPath('),registry:at(registry,'export const HOUSEHOLD_APP_CONFIGS'),
  scope:'ConfigService uses requested/default household and _folderName fallback; unregistered app or unknown household path returns null',
  readers:[at(config,'getHouseholdAppConfig('),at(config,'reloadHouseholdAppConfig('),at(loader,'function loadHouseholdApps(')],
  writers:[at(admin,'writeManagedAppConfig('),at(editor,'writeFile(')],
  codec:{resolver:at(io,'export function resolveYamlPath('),reader:at(io,'export function loadYaml('),serialization:'js-yaml; .yml takes precedence over .yaml'},
  cache:'Getter reads boot snapshot. Explicit app reload updates only on non-null result; missing remains cached, malformed loadYaml throws.',
  startup:'configLoader still merges legacy apps/<name>.yml and apps/<name>/config.yml first, then registry truthy values. Registry-only reload differs from boot union; no flat config/<app> fallback here.',
  atomicity:'Reader path is not a write algorithm. Admin and caller-supplied writers determine write behavior; do not homogenize.',
  modes:'Reader never sets mode; Admin text-atomic writer uses new staging-file mode, not existing target mode',
  cases:['CASE-GR-CONFIG-RELOAD','CASE-GR-ADMIN-DISK-CACHE','CASE-GR-ADMIN-DISK-SCOPE','CASE-GR-ADMIN-DISK-EXTENSION']});
authorities.push({id:'STORE-ADMIN-EDITOR',namespace:'literal household registered configs; system/config YAML; separate managed app and editor address populations',
  resolver:at(admin,'#editorAddress('),registry:at(admin,'export const EDITABLE_CONFIG_FILES'),
  scope:'Constructed with dataDir, not household root. Paths use literal household/ even when ConfigService selects a different folder.',
  writers:[at(admin,'writeEditableDocument('),at(admin,'writeManagedAppConfig(')],
  readers:[at(admin,'readEditableDocument('),at(admin,'readManagedAppConfig(')],
  frontend:at('frontend/src/modules/Admin/utils/adminConfigPaths.js','export function configPath('),
  composition:at('backend/src/app.mjs','const adminConfigStore = new YamlAdminConfigStore'),
  codec:{serialization:'raw takes precedence after parse validation and retains comments; otherwise js-yaml dump indent 2, lineWidth -1, noRefs true, sortKeys false',
    malformedRead:'Editable raw returned with parsed null; service logs parse warning. Managed config similarly remains raw-editable.'},
  cache:'Fresh file read; successful save returns metadata, not parsed/raw. Neither service invokes ConfigService reload; UI retains its own submitted state.',
  atomicity:'FileIO.writeFileAtomic stages beside target and renames; no lock/CAS/fsync. Managed app writer requires parent to exist; generic editor creates it.',
  modes:'New staging inode uses process umask; existing destination mode is not explicitly copied',
  containment:'Lexical path.resolve containment, masks then allowlist; not a claim of symlink confinement. Auth folders cannot be edited through this API.',
  cases:['CASE-GR-ADMIN-DISK-CACHE','CASE-GR-ADMIN-DISK-SCOPE','CASE-GR-ADMIN-DISK-EXTENSION','CASE-GR-ADMIN-DISK-ERRORS','CASE-GR-ADMIN-DISK-MODES']});
authorities.push({id:'STORE-HOUSEHOLD-USERS',namespace:'<householdFolder>/household.yml; users/<username>/profile.yml',
  resolver:at(config,'getHouseholdPath('),scope:'Roster and order household-scoped; profiles live in shared user tree',
  readers:[at(loader,'function loadAllHouseholds('),at(loader,'function loadAllUsers('),at(config,'getHouseholdUsers('),at(config,'getUserProfile(')],
  writers:[at(admin,'writeHousehold('),at(admin,'writeMemberProfile('),at(profileStore,'writeProfile('),at(authAccounts,'createOwner('),at(authAccounts,'acceptInvite(')],
  consumers:[at('backend/src/5_composition/modules/gratitudeApi.mjs','householdDirectory: {')],
  codec:'Boot readYaml and profile loadYamlFromPath; Admin js-yaml plus writeFileAtomic; Fitness saveYamlToPath; Auth DataService.user.write',
  cache:'Roster/profiles cached at boot; explicit reloadUserProfile replaces truthy profile or deletes missing/falsy cache entry. This differs from missing app-config reload retaining cache.',
  atomicity:'Admin stages/renames one document. Fitness and Auth overwrite YAML in place. No transaction spans roster/profile/login/config/cache/device state.',
  modes:'Admin staging mode follows umask; Fitness/Auth retain an existing in-place mode. None of these writers explicitly sets a restrictive profile/login mode.',
  cases:['CASE-STORE-PROFILE-ADMIN-LIFETIME','CASE-STORE-PROFILE-FINGERPRINT-CACHE','CASE-STORE-PROFILE-FINGERPRINT-FAILURE',
    'CASE-STORE-PROFILE-AUTH-MIXED-READS','CASE-STORE-PROFILE-AUTH-PARTIAL-WRITES','CASE-STORE-PROFILE-ADMIN-CREATE-FAILURE'],
  remaining:'Named central writers now reviewed below; arbitrary-path generic callers, installed operator/private writers, concurrent lost updates and full authorization remain separate obligations.'});
authorities.push({id:'STORE-GR-PRINT-TEMP',namespace:'OS temporary directory/gratitude_card_<clock()>.png',
  resolver:at('backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs','const temporaryPath ='),scope:'Process/OS temporary location; no household directory',
  writers:[at(io,'export function writeBinary(')],readers:[at('backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs','printer.createImagePrint(')],
  codec:'Raw rendered PNG buffer',cache:'Ephemeral path only; finally performs best-effort deletion after driver returns/throws',
  atomicity:'Write occurs before try/finally; no exclusive filename and same clock value can collide; initial write failure never enters finally',
  modes:'In-place binary write; default new-file umask, no dedicated print mode',cases:['CASE-GR-TEMP-CLEANUP-false','CASE-GR-TEMP-CLEANUP-true']});
authorities.push({id:'STORE-BROWSER-AUTH',namespace:'localStorage ds_token',resolver:at('frontend/src/lib/auth.js',"const TOKEN_KEY = 'ds_token'"),
  scope:'Browser origin/profile, not a Gratitude-owned household namespace',writers:[at('frontend/src/lib/auth.js','export function setToken('),at('frontend/src/lib/auth.js','export function clearToken(')],
  readers:[at('frontend/src/lib/auth.js','export function getToken('),at('frontend/src/lib/api.mjs',"localStorage.getItem('ds_token')")],
  codec:'Stored token string; getUser decodes token payload JSON without verifying signature',cache:'Reads localStorage on demand',
  atomicity:'Single Web Storage calls, no compound transaction or cross-tab coordination',modes:'Not filesystem permissions',cases:[]});
authorities.push({id:'STORE-BROWSER-DEVICE',namespace:'localStorage ds_device_id',resolver:at('frontend/src/lib/deviceIdentity.js',"const STORAGE_KEY = 'ds_device_id'"),
  scope:'Browser origin/profile identity; explicit fleet window override takes precedence',writers:[at('frontend/src/lib/deviceIdentity.js','window.localStorage.setItem(')],
  readers:[at('frontend/src/lib/deviceIdentity.js','window.localStorage.getItem(')],codec:'Token string; returned value carries fleet/browser/ephemeral provenance',
  cache:'In-memory ID memoized per module; fallback ephemeral token persists only for page lifetime; reset test seam clears memo',
  atomicity:'Read-then-create is not a cross-tab transaction',modes:'Not filesystem permissions',cases:[]});
const affected=new Set([...owners.moves.map(m=>m.old),...owners.foundation.map(f=>f.path)]);
const scanPaths=new Set([...affected,...inputs.keys()]);
const storageReferences=[];
for(const file of scanPaths){
  if(!/\.[cm]?[jt]sx?$/.test(file))continue;
  source(file).split('\n').forEach((line,i)=>{
    if(/localStorage|sessionStorage|indexedDB|\b(?:read|write|load|save|resolve|delete)[A-Z]\w*\s*\(|\.household\.(?:read|write|resolve)|\.user\.(?:read|write|resolve)/.test(line))
      storageReferences.push({path:file,line:i+1,kind:'lexical storage/resolver reference; source must decide behavior, comments are not runtime calls'});
  });
}
const tokenConsumers=ledger.files.filter(f=>f.mode!=='120000'&&f.path.startsWith('frontend/src/')&&/\.[cm]?[jt]sx?$/.test(f.path)&&!/\.(test|spec)\./.test(f.path)).flatMap(f=>{
  const text=fs.readFileSync(path.join(root,f.path),'utf8');
  return /ds_token|ds_device_id/.test(text)?[{path:f.path,references:text.split('\n').flatMap((line,i)=>/ds_token|ds_device_id/.test(line)?[{line:i+1}]:[]),sha256:hash(text)}]:[];
});
for(const file of tokenConsumers)inputs.set(file.path,{path:file.path,sha256:file.sha256});
const memoryOnly=[
  ['frontend/src/hooks/admin/useAdminConfig.js','originalRef','UI edited/original state; no direct YAML or localStorage writer'],
  ['frontend/src/lib/logging/sharedTransport.js','let sharedWsTransport = null','Shared memory queue/transport identity; no own persistent path'],
  ['frontend/src/lib/logging/singleton.js','let singleton = null','Logger/config memory singleton; persistent log sinks remain injected/platform-owned'],
  ['frontend/src/lib/logging/consoleEmitGuard.js','let emitting = false','Reentrancy flag; duplicating module identity can break suppression']
].map(([file,token,behavior])=>({source:at(file,token),behavior}));
const profileMutations=[
  {id:'PROFILE-ADMIN',owner:'Admin workflow; shared household-identity record',
    operations:[at(householdAdmin,'createMember('),at(householdAdmin,'updateMember('),at(householdAdmin,'deleteMember(')],
    persistence:[at(admin,'writeMemberProfile('),at(admin,'writeHousehold(')],
    path:'users/<username>/profile.yml and literal household/household.yml under dataRoot; no configured household-folder routing',
    reads:'Fresh parsed YAML. Missing profile null; malformed YAML throws. Household membership check uses literal on-disk roster.',
    writes:'create validates username, writes profile first, then appends roster; duplicate guard checks roster only. update accepts every body key except username. delete removes roster entry but keeps profile/login/template files.',
    cache:'No ConfigService profile, household roster, platform index or device cache refresh.',
    failure:'Profile can persist after roster write throws; no compensation. Single-document text staging/rename does not make multi-record operation atomic.',
    cases:['CASE-STORE-PROFILE-ADMIN-LIFETIME','CASE-STORE-PROFILE-ADMIN-CREATE-FAILURE']},
  {id:'PROFILE-FITNESS',owner:'Fitness enrollment policy; shared household-identity record',
    operations:[at(profileWriter,'export function createFingerprintProfileWriter(')],
    persistence:[at(profileStore,'readProfile('),at(profileStore,'writeProfile(')],
    composition:at('backend/src/app.mjs','const userProfileDatastore = new YamlUserProfileDatastore'),
    path:'ConfigService.getUserDir(username) + /profile.yml, shared across households',
    reads:'loadYamlFromPath returns null on read/parse errors; writer uses readProfile(...) || {}. Malformed profile can therefore be replaced by a fingerprint-only document.',
    writes:'Read-transform-whole-file in-place save, then synchronous cache refresh. Existing identities preserved, fingerprints append without ID deduplication; remove drops all matching IDs.',
    cache:'Replaces current cached profile only. Previously returned profile objects/Maps and boot-built platform identityMappings remain unchanged.',
    failure:'Thrown save prevents refresh; thrown refresh rejects after file write. Return false and promises from injected synchronous dependencies are not inspected/awaited.',
    deviceOrdering:'ManageAccess awaits successful template enrollment/deletion before profile update; profile failure does not undo device change. Optional missing profileWriter currently permits reported success without persistence.',
    deviceSource:[at('backend/src/3_applications/fitness/usecases/ManageAccess.mjs','await this.#fingerprintProfileWriter?.addFingerprint'),at('backend/src/3_applications/fitness/usecases/ManageAccess.mjs','await this.#fingerprintProfileWriter?.removeFingerprint')],
    cases:['CASE-STORE-PROFILE-FINGERPRINT-CACHE','CASE-STORE-PROFILE-FINGERPRINT-FAILURE']},
  {id:'PROFILE-AUTH',owner:'Authentication account workflow; shared household-identity record',
    operations:[at(authAccounts,'createOwner('),at(authAccounts,'acceptInvite('),at(authAccounts,'listAccounts('),at(authAccounts,'findInvite(')],
    port:at('backend/src/3_applications/auth/ports/IAuthAccountRepository.mjs','export class IAuthAccountRepository'),
    path:'DataService.user profile + auth/login, DataService.household household, DataService.system config/auth',
    reads:'getAccount reads profile/login fresh. listAccounts/findInvite enumerate cached profiles but read login fresh; disk-only new user is not enumerated.',
    writes:'createOwner writes profile, login, household and system auth sequentially; householdId goes in payload but is omitted from household.write scope argument. acceptInvite writes login first, then changes profile only for truthy changed displayName.',
    cache:'No profile/roster/platform-index cache refresh, including after setup or invite acceptance.',
    failure:'DataService false results ignored; method returns undefined and continues. A thrown dependency stops later writes without rolling back earlier writes.',
    cases:['CASE-STORE-PROFILE-AUTH-MIXED-READS','CASE-STORE-PROFILE-AUTH-PARTIAL-WRITES']},
];
const profileCache={
  boot:at(loader,'function buildIdentityMappings('),reload:at(config,'reloadUserProfile('),directory:at(userDirectory,'getHouseholdRoster('),
  bootIndex:'Only truthy user_id/id in non-array object identity values enter platform lookup; duplicate platform IDs are last assignment in loaded-user order. Fingerprint arrays use a separate runtime index.',
  reload:'Reads exact profile.yml; truthy replaces nested users entry, missing/malformed/falsy deletes it. Does not rebuild identityMappings. If original config lacks users, shallow-frozen top-level assignment throws.',
  roster:'Cached household order filtered by optional only list, dropping absent profiles; projection contains id/name/group_label/birthyear. No disk refresh implied by UserService alias.',
  references:'getUserProfile returns the stored object. getAllUserProfiles returns a new Map holding current object references; existing Maps do not receive later replacement entries.',
  proposedBoundary:'Keep roster, profile snapshots, platform lookup and explicit refresh distinct operations. Do not add automatic freshness, canonical User aggregation or storage relocation as part of structural migration.',
  verification:'Named six cases cover only their asserted paths; boot duplicate-ID construction, absent-users reload error and complete HTTP/auth/enrollment authorization are source findings, not newly executed cases.'};
// A fail-closed census of named profile references. This deliberately does not
// mistake generic arbitrary-path access for a proven profile-specific operation.
const profileReferenceDispositions={
  'backend/src/app.mjs':'composition: constructs three writers/readers and explicit Fitness cache refresh; no import/startup performed',
  [config]:'shared config resolver/cache/lookup authority',
  [loader]:'boot profile reader and platform-index constructor',
  'backend/src/0_system/config/configValidator.mjs':'validation diagnostic path only, not a profile writer',
  [profileStore]:'Fitness profile persistence adapter',
  [profileWriter]:'Fitness semantic mutation and cache-refresh orchestration',
  [householdAdmin]:'Admin profile/roster mutation orchestration',
  [admin]:'Admin atomic text persistence and profile reader',
  [authAccounts]:'Auth DataService profile/login writer and mixed cache/disk reader',
  [userDirectory]:'cached profile, roster and platform lookup projection, not persistence',
  'backend/src/3_applications/admin/ports/IAdminConfigStore.mjs':'Admin application port declaration; not an independent data authority',
  'backend/src/3_applications/fitness/manageAccessPolicy.mjs':'pure policy over provided profiles; not a writer',
  'backend/src/3_applications/fitness/usecases/ManageAccess.mjs':'device-then-profile enrollment/removal orchestration',
  'backend/src/4_api/v1/routers/fitness.mjs':'HTTP projection delegates profile mutations to ManageAccess',
  'backend/src/4_api/v1/presenters/publicResourceRefs.mjs':'false-positive: media stream profile query, not user profile storage',
  'backend/src/1_adapters/proxy/HttpDynamicStreamGateway.mjs':'false-positive: media stream profile query, not user profile storage',
  'scripts/migrate-household-config.mjs':'comment about boot identity mapping; script does not become a profile writer by that comment',
  'cli/auth-validator.cli.mjs':'operator profile read through extension-resolving loadYaml; not executed/private data not inspected',
  '_extensions/fingerprint/src/profileStore.mjs':'pure transform/gallery helpers; claimed enrollment CLI in comment is not evidence of a tracked profile writer',
  '_extensions/fitness/src/server.mjs':'template device producer; profile persistence belongs to controller, comment only here',
};
const profileReferences=[];let profileScannedFiles=0;
for(const f of ledger.files){
  if(f.mode==='120000'||! /^(?:backend\/src|cli|scripts|_extensions)\//.test(f.path)
    ||! /\.(?:mjs|js|jsx|py|sh)$/.test(f.path)|| /\.(?:test|spec)\./.test(f.path))continue;
  profileScannedFiles++;
  const text=fs.readFileSync(path.join(root,f.path),'utf8');
  const hits=text.split('\n').flatMap((line,i)=>/profile\.ya?ml|writeMemberProfile|reloadUserProfile|writeProfile\(|["']profile["']/.test(line)?[{line:i+1}]:[]);
  if(!hits.length)continue;
  assert.ok(profileReferenceDispositions[f.path],'Unreviewed named profile reference: '+f.path);
  source(f.path);profileReferences.push({path:f.path,sha256:hash(text),hits,disposition:profileReferenceDispositions[f.path]});
}
assert.equal(profileReferences.length,Object.keys(profileReferenceDispositions).length,'Profile reference population changed; re-adjudicate source');
emit('storage-authorities.json',{schema:'daylight.preimplementation.storage-authorities/v1',baseline:ledger.baseline,
  authorities,primitiveConsumers,storageReferences,tokenConsumers,memoryOnly,
  profileMutations,profileCache,profileReferences,
  profileReferenceScope:{scannedFiles:profileScannedFiles,files:profileReferences.length,
    scope:'Tracked non-symlink backend/src, CLI, scripts and satellites JS/MJS/JSX/Python/shell excluding .test/.spec. All matched named-profile files individually adjudicated.',
    limits:'Not dataflow proof for variable/generic paths, another language, private or installed-only operators. Not authorization to import or execute any indexed command.'},
  primitiveContracts:[at(io,'export function writeFileAtomic('),at(io,'export function saveYamlToPathAtomic('),at(io,'export function writeFileExclusive('),at(io,'export function buildContainedPath(')],
  scope:'Gratitude and directly connected shared/config/admin/browser authorities reviewed; FileIO consumers indexed without granting every caller a semantic boundary',
  remaining:['Review broader FileIO/generic caller path construction before approving the complete foundation move; named central profile writers are now separately adjudicated, not generic-path/installed-writer certification.',
    'Resource URLs/native files and satellite/operator wire/deployment contracts remain distinct PRE-2.3 exits.',
    'No live data or concurrency/durability/cross-platform security certification; current selected disk tests run synthetic macOS files only.'],
  inputs:[...inputs.values()],inventoryInputs:['dependency-ledger.json','owner-boundaries.json','source-ledger.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({authorities:authorities.length,primitiveConsumers:primitiveConsumers.length,storageReferences:storageReferences.length,tokenConsumers:tokenConsumers.length,
  profileMutations:profileMutations.length,profileReferenceFiles:profileReferences.length,profileScannedFiles})+'\n');
