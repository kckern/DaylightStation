/** Source-only FileIO binding/call census. Never evaluate a product module. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root,packet,emit} from './census.mjs';
assert.ok(process.env.PRE_TOOLCHAIN_ROOT,'Explicit installed parser toolchain required');
const toolRoot=fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT),req=createRequire(path.join(toolRoot,'package.json'));
const {parse}=req('@babel/parser'),traverse=req('@babel/traverse').default;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const ledger=read('source-ledger.json'),graph=read('dependency-ledger.json');
const owners=read('owner-boundaries.json'),boundaries=read('boundary-review.json');
const io='backend/src/0_system/utils/FileIO.mjs',barrel='backend/src/0_system/utils/index.mjs';
const inputs=new Map(),texts=new Map();
function source(file){
  if(!texts.has(file)){const text=fs.readFileSync(path.join(root,file),'utf8');texts.set(file,text);inputs.set(file,{path:file,sha256:hash(text)});}
  return texts.get(file);
}
const contracts=new Map();
function group(names,properties){for(const name of names.split(' ')){assert.ok(!contracts.has(name),'Duplicate primitive '+name);contracts.set(name,{name,pathArguments:[0],...properties});}}
group('buildContainedPath getBasename',{effect:'pure path computation',codec:'none',failure:'native argument errors; containment may return null',atomicity:'no write'});
group('resolveYamlPath yamlExists resolveContainedYaml',{effect:'YAML path discovery',codec:'yml before yaml; explicit yml/yaml suffix kept',failure:'absent path null/false; not general catch-all',atomicity:'no write'});
group('loadYaml',{effect:'read',codec:'js-yaml, extension resolving',failure:'absent null; read/parse errors throw',atomicity:'no write'});
group('loadYamlSafe loadContainedYaml loadYamlFromPath',{effect:'read',codec:'js-yaml; per-helper exact path/containment/extension behavior',failure:'read/parse errors suppressed to null; contained path computation can still throw',atomicity:'no write'});
group('readYamlFromPath',{effect:'read',codec:'js-yaml exact path',failure:'native read/parse errors throw',atomicity:'no write'});
group('listYamlFiles listSubdirectories listEntries',{effect:'directory read',codec:'directory names; see per-helper filtering',failure:'missing returns []; other readdir errors throw',atomicity:'no write'});
group('listDirs listFiles listDirsMatching',{effect:'directory read',codec:'directory names; symlink targets conditionally followed',failure:'filesystem failures produce []; supplied pattern may throw',atomicity:'no write'});
group('dirExists isExecutable isFile',{effect:'metadata read',codec:'boolean',failure:'filesystem failures false',atomicity:'no write'});
group('fileExists',{effect:'metadata read',codec:'boolean; any existing type, not just a file',failure:'native existsSync behavior',atomicity:'no write'});
group('fileExistsAsync',{effect:'metadata read',codec:'boolean',failure:'only ENOENT becomes false; others reject',atomicity:'no write'});
group('getStats resolveRealPath',{effect:'metadata read',codec:'Stats/path or null',failure:'filesystem failures null',atomicity:'no write'});
group('getFileStats getFileStatsAsync readDirectory readDirectoryAsync',{effect:'metadata/directory read',codec:'Stats/native directory entries/options',failure:'native errors throw/reject',atomicity:'no write'});
group('readFile readBinary',{effect:'read',codec:'UTF-8 text or Buffer respectively',failure:'missing/read error null',atomicity:'no write'});
group('readTextFromPath readTextFromPathAsync readBinaryFromPath readBinaryFromPathAsync',{effect:'read',codec:'UTF-8 text or Buffer respectively',failure:'native errors throw/reject',atomicity:'no write'});
group('ensureDir ensureDirAsync',{effect:'directory creation',codec:'none',failure:'native errors throw/reject',atomicity:'recursive mkdir, not transactional'});
group('createTempDir',{effect:'directory creation',codec:'none',failure:'native errors reject',atomicity:'native unique mkdtemp suffix',modes:'native mkdtemp directory mode, not a file mode'});
group('saveYaml saveYamlToPath',{effect:'write',codec:'js-yaml dump lineWidth -1 plus caller options; saveYaml appends extension',failure:'errors throw',atomicity:'whole-file in-place; create parent',modes:'existing inode retained; new file uses umask'});
group('writeFile writeTextFileAsync writeBinary writeBinaryAsync',{effect:'write',codec:'UTF-8 text or raw bytes',failure:'errors throw/reject',atomicity:'in-place, create parent',modes:'existing inode retained; new file uses umask; text async allows caller options'});
group('writeTextFileStrictAsync writeBinaryExclusiveAsync',{effect:'write',codec:'UTF-8 text/raw bytes',failure:'native errors reject, including missing parent; binary exclusive preserves EEXIST',atomicity:'no parent creation; text overwrites, binary wx',modes:'native default'});
group('writeFileAtomic writeBinaryAtomic saveYamlToPathAtomic',{effect:'write',codec:'UTF-8 text/raw bytes/js-yaml respectively',failure:'errors throw; staging cleanup best effort',atomicity:'same-directory staging then rename; no read-modify-write lock or multi-file transaction',modes:'new staging inode uses umask, existing target mode not copied'});
group('writeFileExclusive writeBinaryExclusive openFileExclusive',{effect:'exclusive create',codec:'UTF-8 text/raw bytes/file descriptor respectively',failure:'native errors, notably EEXIST',atomicity:'wx create; parent ensured',modes:'optional caller mode for text/binary writes, not openFileExclusive'});
group('appendTextFile openFileForAppend createAppendWriteStream',{effect:'append',codec:'UTF-8 text/file descriptor/stream respectively',failure:'native errors; stream errors are asynchronous',atomicity:'parent ensured; not a multi-record transaction',modes:'native default; existing mode retained'});
group('createWriteStream createReadStream',{effect:'stream construction',codec:'native stream and caller options',failure:'native constructor/events, not suppressed',atomicity:'no automatic parent creation; lifetime belongs to caller'});
group('truncateFile setFileTimes',{effect:'file mutation',codec:'byte length/timestamps respectively',failure:'native errors throw',atomicity:'single native operation; no transaction'});
group('renameFile renameFileAsync createHardLinkAsync copyFileAsync',{effect:'two-path mutation',pathArguments:[0,1],codec:'none',failure:'native errors',atomicity:'native operation, no parent creation or compound transaction'});
group('writeToFileDescriptor closeFileDescriptor syncFileDescriptor',{effect:'descriptor mutation',pathArguments:[],descriptorArguments:[0],codec:'bytes/descriptor',failure:'native errors; descriptor write also rejects zero/invalid progress',atomicity:'caller-owned descriptor lifetime; write loops over partial progress'});
group('deleteFile deleteYaml deleteDir',{effect:'delete',codec:'none',failure:'missing/failure false',atomicity:'single file or recursive tree; deleteYaml attempts both suffixed paths'});
group('deleteFileStrict deleteFileStrictAsync removeFileAsync deleteDirAsync',{effect:'delete',codec:'none',failure:'native errors; optional force for removeFileAsync/deleteDirAsync',atomicity:'single file/recursive tree; no transaction'});
group('findFileByPrefix findYamlByPrefix findMediaFileByPrefix loadYamlByPrefix',{effect:'cached directory/read',codec:'numeric-prefix path matching; last function also js-yaml',failure:'missing/stat failure null; listing errors can throw',atomicity:'module-level directory-mtime cache; not content freshness or inode identity'});
group('saveImage',{effect:'network plus file write',pathArguments:[1,2,3],urlArguments:[0],codec:'HTTP response stream into folder/uid.jpg without image conversion',failure:'falsy URL false; awaited HTTP errors false; returned writer rejection propagates',atomicity:'24-hour mtime reuse; otherwise direct stream overwrite, no staging or failed-file cleanup'});
group('createImageIO',{effect:'captures media root in image-download callback',codec:'bound saveImage',failure:'same saveImage contract on invocation',atomicity:'factory itself does not read/write; callback shares FileIO implementation/cache'});
contracts.get('buildContainedPath').pathArguments=[0,1];
contracts.get('getBasename').failure='native argument errors';
contracts.get('buildContainedPath').note='Normalizes and strips leading parent traversals before lexical containment; not rejection of every ../ input and not realpath/symlink confinement.';
for(const name of ['resolveContainedYaml','loadContainedYaml'])contracts.get(name).pathArguments=[0,1];
contracts.get('saveYamlToPathAtomic').note='durable option alone fsyncs staged file then containing directory after rename. Post-rename fsync error can occur after new target is visible.';
contracts.get('listYamlFiles').note='Nonrecursive filtering excludes only ._ by default; recursive mode also excludes dot entries and follows dirent directories, not symlink-directory targets. No explicit sort.';
contracts.get('deleteYaml').note='Always appends .yml and .yaml even when caller supplied an extension; attempts both.';
const ioAst=parse(source(io),{sourceType:'module'}),primitives=[];
// Independent miniature input: lexical shadowing must not become an IO call,
// while passing the imported function as a value must not disappear.
const probe=parse("import {readFile as read} from 'synthetic'; function shadow(read){read('not-imported');} read('direct'); const supplied = read;",{sourceType:'module'});
traverse(probe,{Program(p){const refs=p.scope.getBinding('read').referencePaths;
  assert.deepEqual(refs.map(r=>r.parentPath.node.type),['CallExpression','VariableDeclarator']);p.stop();}});
for(const statement of ioAst.program.body){
  if(statement.type!=='ExportNamedDeclaration')continue;
  const fn=statement.declaration;assert.equal(fn?.type,'FunctionDeclaration','New FileIO export shape needs review');
  assert.ok(contracts.has(fn.id.name),'Unclassified FileIO export '+fn.id.name);
  primitives.push({...contracts.get(fn.id.name),line:fn.loc.start.line,endLine:fn.loc.end.line,sha256:hash(source(io).slice(fn.start,fn.end)),
    async:fn.async,parameters:fn.params.map(p=>source(io).slice(p.start,p.end))});
}
assert.equal(primitives.length,contracts.size,'Retired/extra primitive classification');assert.equal(primitives.length,77);

// Follow actual re-export declarations, not an assumption that a barrel's every
// consumer uses every filesystem function eagerly included by its dependency.
const carriers=new Map([[io,new Map(primitives.map(p=>[p.name,p.name]))]]);
let changed=true;
while(changed){changed=false;for(const edge of graph.edges){
  if(!carriers.has(edge.target)||!['ExportNamedDeclaration','ExportAllDeclaration'].includes(edge.syntax))continue;
  const names=carriers.get(edge.target),dest=carriers.get(edge.from)||new Map();
  for(const [exported,origin] of edge.syntax==='ExportAllDeclaration'?[...names]:
    (edge.symbols||[]).filter(s=>names.has(s.imported)).map(s=>[s.exported,names.get(s.imported)])){
    if(dest.has(exported)){assert.equal(dest.get(exported),origin,'Ambiguous IO re-export');continue;}
    dest.set(exported,origin);changed=true;
  }
  if(dest.size)carriers.set(edge.from,dest);
}}
const relevant=graph.edges.filter(e=>carriers.has(e.target));
const byFile=new Map();for(const e of relevant)byFile.set(e.from,[...(byFile.get(e.from)||[]),e]);
const consumers=[],uses=[],unbound=[],parseErrors=[];
const loc=(file,node)=>({path:file,line:node.loc.start.line,endLine:node.loc.end.line,start:node.start,end:node.end,type:node.type,
  sha256:hash(source(file).slice(node.start,node.end))});
function isTest(file){return file.startsWith('tests/')||file.startsWith('backend/tests/')||/\.(?:test|spec)\./.test(file);}
for(const [file,edges] of byFile){
  const text=source(file);let ast;
  try{ast=parse(text,{sourceType:'unambiguous',allowReturnOutsideFunction:true,plugins:['jsx',...( /\.tsx?$/.test(file)?['typescript']:[]),'decorators-legacy']});}
  catch(error){parseErrors.push({file,line:error.loc?.line,reason:error.reasonCode});continue;}
  const importedBindings=[],seenEdges=new Set();
  function trackBinding(p,e,local,imported){
    const names=carriers.get(e.target),origin=imported==='*'?'*':names.get(imported);
    if(!origin)return;
    const binding=p.scope.getBinding(local);assert.ok(binding,'Missing lexical binding '+file+':'+local);
    importedBindings.push({edgeId:e.id,local,imported,origin,references:binding.referencePaths.length,
      constantViolations:binding.constantViolations.map(x=>loc(file,x.node))});
    if(!binding.referencePaths.length)uses.push({edgeId:e.id,local,origin,kind:'unreferenced binding',source:loc(file,binding.path.node)});
    for(const ref of binding.referencePaths){
      let use=ref,selected=origin;
      if(origin==='*'&&ref.parentPath.isMemberExpression()&&ref.parentPath.node.object===ref.node){
        use=ref.parentPath;const member=use.node.property;
        selected=!use.node.computed?names.get(member.name):member.type==='StringLiteral'?names.get(member.value):null;
      }
      const parent=use.parentPath,isCall=(parent.isCallExpression()||parent.isOptionalCallExpression())&&parent.node.callee===use.node;
      const row={edgeId:e.id,local,origin:selected||origin,kind:isCall?'direct call':origin==='*'?'namespace escape/computed access':'supplied/re-exported function reference',source:loc(file,use.node),parent:loc(file,parent.node)};
      if(isCall){
        row.call=loc(file,parent.node);
        row.arguments=parent.get('arguments').map(arg=>{
          const result=loc(file,arg.node),definitions=new Map();
          function capture(p){
            if(!p.isReferencedIdentifier())return;
            const b=p.scope.getBinding(p.node.name);if(!b)return;
            const n=b.path.node;definitions.set(n.start,{name:p.node.name,kind:b.kind,...loc(file,n)});
          }
          capture(arg);arg.traverse({ReferencedIdentifier:capture});
          result.bindingDefinitions=[...definitions.values()];
          if(arg.isStringLiteral())result.literalKind=path.isAbsolute(arg.node.value)?'absolute source literal (value withheld)':'relative or non-path source literal';
          return result;
        });
        row.pathArgumentIndexes=selected&&selected!=='*'?contracts.get(selected).pathArguments:null;
      }
      uses.push(row);
    }
  }
  function match(p,spec){
    const id='EDGE-'+hash(file+':'+p.node.start+':'+spec).slice(0,16),edge=edges.find(e=>e.id===id);
    if(edge)seenEdges.add(id);return edge;
  }
  traverse(ast,{
    ImportDeclaration(p){const e=match(p,p.node.source.value);if(!e)return;
      for(const s of p.node.specifiers)trackBinding(p,e,s.local.name,s.type==='ImportNamespaceSpecifier'?'*':s.type==='ImportDefaultSpecifier'?'default':s.imported.name||s.imported.value);
    },
    ExportNamedDeclaration(p){if(p.node.source)match(p,p.node.source.value);},
    ExportAllDeclaration(p){match(p,p.node.source.value);},
    CallExpression(p){
      if(p.node.callee.type!=='Import'&&p.node.callee.name!=='require')return;
      const spec=p.node.arguments[0];if(spec?.type!=='StringLiteral')return;const e=match(p,spec.value);if(!e)return;
      const owner=p.parentPath.isAwaitExpression()?p.parentPath.parentPath:p.parentPath;
      if(owner.isVariableDeclarator()&&owner.node.id.type==='ObjectPattern'){
        for(const prop of owner.node.id.properties){
          if(prop.type!=='ObjectProperty'||prop.computed||prop.value.type!=='Identifier'){
            unbound.push({edgeId:e.id,source:loc(file,prop),reason:'dynamic import destructuring/rest/default needs separate review'});continue;
          }
          trackBinding(owner,e,prop.value.name,prop.key.name||prop.key.value);
        }
      }else if(owner.isVariableDeclarator()&&owner.node.id.type==='Identifier')trackBinding(owner,e,owner.node.id.name,'*');
      else unbound.push({edgeId:e.id,source:loc(file,p.node),reason:'non-direct dynamic/require assignment; chain/callback return needs source review'});
    },
  });
  assert.equal(seenEdges.size,edges.length,'Parser/graph FileIO edge population mismatch in '+file);
  const fileUses=uses.filter(u=>edges.some(e=>e.id===u.edgeId));
  consumers.push({path:file,sha256:hash(text),role:isTest(file)?'test':file.startsWith('cli/')?'operator CLI':file.startsWith('backend/src/1_adapters/')?'adapter':file.startsWith('backend/src/0_system/')?'system': 'other production layer',
    edges:edges.map(e=>({id:e.id,line:e.line,specifier:e.specifier,target:e.target,syntax:e.syntax})),bindings:importedBindings,
    directCalls:fileUses.filter(u=>u.kind==='direct call').length,
    nonCallReferences:fileUses.filter(u=>u.kind!=='direct call').length,
    disposition:file===barrel?'retire/split mixed barrel edges by actual symbol in approved foundation work':
      !importedBindings.length?'eager dependency/re-export or unbound dynamic import, not necessarily a filesystem operation':
      'retain caller policy/path construction; replace only approved import binding; preserve primitive identity and exact source-referenced arguments',
    semanticReview:'Binding inventory, not namespace/authorization/runtime proof; path definitions and non-call references require attributed review'});
}
assert.deepEqual(parseErrors,[],'Storage binding source parse failure');
assert.equal(consumers.reduce((n,c)=>n+c.edges.length,0),relevant.length);
const nonCallPolicies=[];
function policy(id,files,names,mechanism,scope){nonCallPolicies.push({id,files,names:names.split(' '),mechanism,scope,
  preserve:'Keep current default-versus-injected dependency selection, sync/async behavior and path supplier. This disposition classifies the function reference, not all downstream IO/authorization.'});}
policy('IO-PREDICATE',['backend/src/1_adapters/content/LegacyLocalContentRepository.mjs'],'dirExists',
  'Passed to candidates.find; predicate receives candidate as its first argument. Still an actual filesystem read, not a missing call.',
  'Ordered source/media/data scripture directory candidates; first existing directory else first candidate. No source relocation of runtime roots.');
policy('IO-DIRECTORY-CALLBACK',['backend/src/1_adapters/persistence/yaml/gaming/YamlGamingEffectStore.mjs'],'ensureDir',
  'Constructor passes ensureDir to forEach over receipts/audit/sessions directory array.',
  'Injected effectsDir with three named children; constructor performs directory creation.');
policy('IO-DEFAULT-CANVAS',['backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs'],'fileExists getFileStats readDirectory readBinaryFromPath',
  'defaultFs renames helpers to fs-like methods; deps.fs || defaultFs chooses the whole object, not a merged override.',
  'config.basePath plus local IDs/categories. Source methods, not method names alone, determine path validation.');
policy('IO-DEFAULT-MIRROR',['backend/src/1_adapters/health/FilesystemHealthArchiveMirror.mjs'],'getFileStatsAsync readBinaryFromPathAsync writeBinaryAsync readDirectoryAsync',
  'systemIo method table is constructor default io; supplying io replaces the whole table.',
  'Per-operation sourceRoot/destinationRoot/relativeName; copy reads bytes then writes, not an atomic mirror transaction.');
policy('IO-DEFAULT-EMERGENCY',['backend/src/1_adapters/persistence/yaml/YamlEmergencyLockDatastore.mjs'],'loadYamlFromPath saveYamlToPath deleteFile',
  'Independent destructured load/save/remove defaults copied to private fields and invoked synchronously inside async methods.',
  'Construction-fixed householdId resolves fitness/log/emergency_lock.yml; invalid record becomes null, clear ignores false.');
policy('IO-DEFAULT-SHUTDOWN',['backend/src/1_adapters/persistence/yaml/YamlShutdownDatastore.mjs'],'loadYaml saveYamlToPathAtomic',
  'Destructured load/save defaults copied to private fields; parse failure retained as invalid:true.',
  'ConfigService default household shutdown/lockdown.yml; retained record differs from Fitness emergency lock.');
policy('IO-DEFAULT-PROFILE',['backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.mjs'],'loadYamlFromPath saveYamlToPath',
  'Destructured load/save defaults copied to private fields; explicit named profile review and six cases apply.',
  'ConfigService shared users/<username>/profile.yml, not household-local.');
policy('IO-DEFAULT-SCHOOL-CATALOG',[
  'backend/src/1_adapters/school/catalog/YamlLearningCatalogRepository.mjs',
  'backend/src/1_adapters/school/catalog/YamlLearningContentRepository.mjs',
  'backend/src/1_adapters/school/catalog/YamlSurfaceProfileRepository.mjs'], 'listYamlFiles loadYaml',
  'Per-method io.list/io.load nullish fallback, unlike whole-object replacement. Retain supplied override identity.',
  'Injected catalog directories, document/action directories or surface-profile directory; each owns its scanning/validation policy.');
policy('IO-DEFAULT-SCHOOL-STATE',[
  'backend/src/1_adapters/school/documents/YamlAllocationStore.mjs',
  'backend/src/1_adapters/school/documents/YamlHeldCardScanStore.mjs',
  'backend/src/1_adapters/school/persistence/YamlRemediationSessionRepository.mjs',
  'backend/src/1_adapters/schoolcalc/persistence/YamlSchoolCalcDeviceRepository.mjs',
  'backend/src/1_adapters/schoolcalc/persistence/YamlSchoolCalcProgressRepository.mjs',
  'backend/src/1_adapters/schoolcalc/persistence/YamlSchoolCalcResultLedger.mjs',
  'backend/src/1_adapters/schoolcalc/persistence/YamlSchoolCalcStudySessionRepository.mjs'], 'loadYamlFromPath saveYamlToPathAtomic',
  'Per-method io.load/io.save nullish fallback captured in private IO table. Individual store serialization, validation and write queues remain caller-owned.',
  'Injected directories; allocation/card state, scan-protection/held-scans.yml, remediation sessions and calculator device/progress/result/adaptive-study records are not one interchangeable namespace.');
policy('IO-DEFAULT-PRINT-DOCUMENTS',['backend/src/1_adapters/school/documents/YamlPrintDocumentRepository.mjs'],'listYamlFiles loadYaml saveYaml',
  'Per-method list/load/save nullish fallback; existing stat wrapper is distinct and remains source-indexed.',
  'Injected output directory plus optional sourceDirectory with its existing filtering rules.');
policy('IO-DEFAULT-CALCULATOR-ARTIFACT',['backend/src/1_adapters/schoolcalc/persistence/FsSchoolCalcArtifactRepository.mjs'],'fileExists loadYamlFromPath readBinary saveYamlToPathAtomic writeBinaryAtomic',
  'Per-method exists/loadMetadata/readBytes/saveMetadata/writeBytes nullish fallback; binary and metadata remain separate operations.',
  'Injected artifact directory and validated IDs; two atomic files are not automatically a compound transaction.');
policy('IO-DEFAULT-STATE-GATES',['backend/src/1_adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs'],'saveYamlToPathAtomic',
  'Destructured save default captured independently from strictLoad wrapper; preserve resolveFilePath timing.',
  'Injected filePath or resolver and retained journal/projection state; do not merge with permissive loaders.');
policy('IO-CLI-ARCHIVE',['cli/lib/fitness/reconstruct.mjs'],'loadYamlSafe',
  'Dynamic-import binding placed in archiveDeps and passed to local findArchive; parameter calls are not direct references to imported binding.',
  'Configured Strava and older archive directories; preserve ordered lookup and operator invocation, never execute for inventory.');
policy('IO-UNUSED',[
  'backend/src/1_adapters/messaging/TelegramAdapter.mjs',
  'backend/src/1_adapters/persistence/yaml/YamlFinanceDatastore.mjs',
  'backend/src/1_adapters/persistence/yaml/YamlJournalDatastore.mjs',
  'backend/src/1_adapters/persistence/yaml/YamlLifeplanMetricsStore.mjs'],'fileExists ensureDir',
  'Lexical imported binding has no references in this source; retain as import-only impact, not a storage call or cleanup permission.',
  'No path authority contributed by this unused binding. Other bindings in the same file still have effects.');
const productionNonCalls=uses.filter(u=>u.kind!=='direct call'&&!isTest(u.source.path));
for(const use of productionNonCalls){
  const choices=nonCallPolicies.filter(p=>p.files.includes(use.source.path)&&p.names.includes(use.origin));
  assert.equal(choices.length,1,'Unadjudicated/ambiguous production IO function reference '+use.source.path+':'+use.source.line);
  use.referencePolicy=choices[0].id;
}
assert.equal(productionNonCalls.length,51,'Changed production function-reference population needs source review');
for(const p of nonCallPolicies)p.references=productionNonCalls.filter(u=>u.referencePolicy===p.id).map(u=>({edgeId:u.edgeId,source:u.source,origin:u.origin}));
const summary={primitiveExports:primitives.length,carrierFiles:carriers.size,consumerFiles:consumers.length,
  directIOEdges:relevant.filter(e=>e.target===io).length,allCarrierEdges:relevant.length,
  bindings:consumers.reduce((n,c)=>n+c.bindings.length,0),uses:uses.length,directCalls:uses.filter(u=>u.kind==='direct call').length,
  nonCallReferences:uses.filter(u=>u.kind!=='direct call').length,reviewedProductionNonCallReferences:productionNonCalls.length,
  referencePolicies:nonCallPolicies.length,unboundDynamicImports:unbound.length,parseErrors:parseErrors.length};
function anchor(file,token){const text=source(file),start=text.indexOf(token);assert.ok(start>=0,'Missing storage boundary anchor '+file+':'+token);
  return {path:file,line:text.slice(0,start).split('\n').length,anchor:token};}
// Separate moving implementation locations from the runtime paths supplied to
// FileIO. Indexing every affected import is not evidence that every caller moves.
const candidatePaths=new Map(owners.moves.map(m=>[m.old,m.new]));
for(const file of boundaries.files)if(file.proposedPath&&file.proposedPath!==file.path){
  assert.ok(!candidatePaths.has(file.path),'Overlapping product/foundation move');
  candidatePaths.set(file.path,file.proposedPath);
}
const store='backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs';
const printer='backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs';
const pathPolicies=[{
  id:'MOVE-PATH-GR-SNAPSHOTS',file:store,authority:'STORE-GR-SNAPSHOTS',
  anchors:[anchor(store,'#getSnapshotDir(householdId) {'),anchor(store,'#ensureSnapshotDir(householdId) {'),
    anchor(store,"this.#dataService.household.resolvePath('gratitude/snapshots', householdId)"),
    anchor('backend/src/1_adapters/persistence/files/DataService.mjs','#createHouseholdScope() {'),
    anchor('backend/src/0_system/config/ConfigService.mjs','getHouseholdPath(relativePath, householdId = null) {'),
    anchor(store,"const stamp = moment().format('YYYYMMDD_HHmmss');")],
  root:'Current injected DataService household.resolvePath(gratitude/snapshots, householdId), strip only trailing .yml. ConfigService supplies data root and household folder; neither derives from adapter source URL.',
  leaves:'save uses wall-clock YYYYMMDD_HHmmss plus snapshot.id, then saveYaml appends suffix. list/load use listed basenames; ID lookup is first filename substring, missing ID falls back to latest filename.',
  behavior:'ensureDir before save; whole-file synchronous in-place YAML with no lock/transaction. List includes malformed files with fallback metadata; load of malformed selected file returns null, not an older valid record. file metadata is only added to the returned value.',
  nonPrimitiveIO:'Options/selections/discarded read/write through the injected DataService household scope; STORE-GR-ARRAYS separately describes explicit dotted .yml names and hydration.',
  cases:['CASE-GR-HTTP-11','CASE-GR-HTTP-12','CASE-GR-HTTP-13','CASE-GR-SNAPSHOT-FILES','CASE-GR-DISK-PATHS'],
  expectedOperations:{ensureDir:1,saveYaml:1,dirExists:2,listYamlFiles:2,loadYamlSafe:2},
  remaining:'Preserve injected DataService identity and captured backend moment/timezone scope through actual package install; candidate/rollback comparison and exhaustive permission/crash/concurrency failures remain separate gates.'
},{
  id:'MOVE-PATH-GR-PRINT',file:printer,authority:'OS task temporary artifact, not a persistent household namespace',
  anchors:[anchor(printer,'const temporaryPath ='),anchor(printer,'writeBinary(temporaryPath, buffer);'),
    anchor(printer,'return await printer.print('),anchor(printer,'deleteFile(temporaryPath);'),
    anchor('backend/src/5_composition/modules/fitnessApi.mjs','imagePrintGateway: new TemporaryImagePrintGateway()'),
    anchor('backend/src/5_composition/modules/gratitudeApi.mjs','imagePrintGateway: new TemporaryImagePrintGateway()')],
  root:'os.tmpdir() at each print invocation; current TMPDIR/OS policy, not source URL or household data root.',
  leaves:'gratitude_card_<clock()>.png; constructor clock defaults Date.now. Raw buffer bytes, no encoding conversion; retain existing collision behavior.',
  behavior:'Write is before try/finally; write failure does not enter cleanup. Within try createImagePrint receives filename plus all remaining options, print gets its exact result; await result/error identity preserved. Finally deletes best-effort, false ignored. No new retry, atomic write, lock or per-product naming.',
  publicBoundary:'DEC-PRINT-EXPORT; app-owned adapter public only to composition/test consumers; actual extends of private Gratitude application port stays intact.',
  cases:['CASE-GR-TEMP-CLEANUP-false','CASE-GR-TEMP-CLEANUP-true','CASE-GR-TEMP-CONTRACT','CASE-EXISTING-GR-PRINT-01'],
  expectedOperations:{writeBinary:1,deleteFile:1},
  remaining:'Original test passes unchanged on baseline; migrated public-entry/port/FileIO identity still requires native candidate proof. Existing adapter raw path prohibition and OS-temp capability ownership must be adjudicated by IMP-BASE.02; no exemption is inferred from current source.'
}];
for(const policy of pathPolicies){
  const calls=uses.filter(u=>u.source.path===policy.file&&u.kind==='direct call');
  const counts=Object.fromEntries(Object.keys(policy.expectedOperations).map(name=>[name,calls.filter(u=>u.origin===name).length]));
  assert.deepEqual(counts,policy.expectedOperations,'Changed moving storage primitive population');
  assert.equal(calls.length,Object.values(policy.expectedOperations).reduce((n,v)=>n+v,0));
  assert.ok(candidatePaths.has(policy.file),'Path policy target no longer moves');
  policy.destination=candidatePaths.get(policy.file);
  policy.callSites=calls.map(u=>({edgeId:u.edgeId,primitive:u.origin,call:u.call,pathArguments:u.pathArgumentIndexes}));
}
const movingConsumers=consumers.filter(c=>candidatePaths.has(c.path)).map(c=>{
  const policy=pathPolicies.find(p=>p.file===c.path);
  assert.ok(policy||c.directCalls===0&&c.nonCallReferences===0,'New moving filesystem authority needs review: '+c.path);
  return {path:c.path,destination:candidatePaths.get(c.path),directCalls:c.directCalls,nonCallReferences:c.nonCallReferences,
    pathPolicy:policy?.id||null,disposition:policy?'retain reviewed runtime path authority while source/imports move':
      'carrier re-export or clock-only dependency; no imported FileIO function use. Per-symbol barrel split still has loader/layer consequences.'};
});
const retainedConsumers=consumers.filter(c=>!candidatePaths.has(c.path)).map(c=>({path:c.path,directCalls:c.directCalls,nonCallReferences:c.nonCallReferences,
  disposition:'source location retained in this candidate set; affected import/loader and filesystem semantics still require approval'}));
const firstMoveImpact={candidateDefinition:'31 Gratitude move rows plus non-null changed foundation source destinations; conditional extra font resources are outside this filesystem-consumer population',
  provider:{path:io,destination:candidatePaths.get(io),entry:boundaries.files.find(f=>f.path===io).entry,
    pathPolicy:'No own source-relative data root. One canonical implementation/cache, existing captured js-yaml/axios scopes, and all unchanged caller arguments must survive.'},
  summary:{movingConsumerFiles:movingConsumers.length,movingDirectIOFiles:movingConsumers.filter(c=>c.directCalls).length,
    movingDirectCalls:movingConsumers.reduce((n,c)=>n+c.directCalls,0),retainedConsumerFiles:retainedConsumers.length,
    retainedDirectCalls:retainedConsumers.reduce((n,c)=>n+c.directCalls,0)},
  movingConsumers,retainedConsumers,pathPolicies,
  limit:'This closes source-derived path disposition for physically moving direct FileIO callers only. It does not approve the 299 retained consumers, facade/package identity, broader namespace census, installed writers or deployment.'};
assert.deepEqual(firstMoveImpact.summary,{movingConsumerFiles:7,movingDirectIOFiles:2,movingDirectCalls:10,retainedConsumerFiles:299,retainedDirectCalls:1400});
assert.equal(firstMoveImpact.provider.destination,'platform/server/system/utils/FileIO.mjs');
assert.equal(firstMoveImpact.provider.entry,'@daylight/platform/server/system/utils/file-io');
const imageBoundary={
  id:'STORAGE-HARVESTER-IMAGE',owner:'harvester image-storage adapter over platform IO mechanism',
  source:[anchor('backend/src/1_adapters/harvester/HarvesterImageStore.mjs','save = (url, folder, uid)'),
    anchor('backend/src/app.mjs','const imgBasePath ='),anchor('backend/src/app.mjs','const harvesterIo ='),
    anchor('backend/src/5_composition/bootstrap.mjs','export function createHarvesterServices('),
    anchor('backend/src/5_composition/bootstrap.mjs','const infinityHarvesters = createInfinityHarvesters('),
    anchor('backend/src/1_adapters/harvester/other/InfinityHarvester.mjs','export function createInfinityHarvesters('),
    anchor('backend/src/1_adapters/harvester/other/InfinityHarvester.mjs','async #saveImages('),
    anchor('backend/src/0_system/config/ConfigService.mjs','getPath(name)')],
  pathAuthority:'ConfigService.getPath(img) chooses explicit system.paths.img or mediaDir/img; app fallback also derives from getMediaDir, never source directory. Harvester tableKey and item uid produce folder/uid.jpg.',
  injection:'HarvesterImageStore.save arrow captures imageDirectory. harvesterIo.saveImage is passed through bootstrap factory and createInfinityHarvesters into each configured Infinity adapter.',
  consumerResult:'Infinity awaits callback but ignores false return, replacing item.image with host-prefixed /media/img/<tableKey>/<uid> anyway. A thrown/rejected callback warns and leaves original image URL. Public URL omits jpg suffix; root override is not reflected in this URL.',
  verification:'Source review only; no HTTP/provider/download was run and no live board/configuration was inspected. Only one direct external saveImage caller exists in the graph; createImageIO has no imported binding use.',
  preserve:'Configured media root, table/uid naming, callback capture, false versus rejection behavior and URL projection must not be changed with FileIO source/import relocation.'};
emit('storage-consumer-review.json',{schema:'daylight.preimplementation.storage-consumers/v1',baseline:ledger.baseline,
  summary,primitives,carriers:[...carriers].map(([file,names])=>({file,names:Object.fromEntries(names)})),consumers,uses,nonCallPolicies,unboundDynamicImports:unbound,imageBoundary,firstMoveImpact,
  policy:{owner:'platform filesystem mechanism, not ownership of callers persisted namespaces',
    publicEntry:'proposed @daylight/platform/server/system/utils/file-io; no package created or API approved here',
    layers:'D5/D10 unchanged: application/domain code does not gain FileIO access through public package names; adapters implement semantic ports',
    identity:'Retain one FileIO module instance per current loader graph, its directory cache and captured js-yaml/axios dependency scopes',
    sourceLocation:'FileIO itself contains no data root derived from its own source directory; callers supply all path authorities. Do not relocate those persisted paths.',
    safety:'Inspection only. saveImage and bound callbacks can perform network/write effects; importing a clock barrel is not calling these functions.'},
  remaining:['Adjudicate each source-referenced generic path definition and injected function escape into exact namespace/resource authority, without treating static binding discovery as runtime proof.',
    'All current dynamic-literal bindings resolved and 51 production non-call references adjudicated; expand downstream injected/parameter invocations and caller namespace validation as needed for each move. Direct calls alone are not invocation coverage.',
    'Connect approved consumer dispositions to public import matrix and actual affected-owner tests; private/installed-only operators remain distinct external inventory.'],
  inputs:[...inputs.values()],inventoryInputs:['source-ledger.json','dependency-ledger.json','owner-boundaries.json','boundary-review.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolchain:['@babel/parser','@babel/traverse'].map(name=>{const pkg=req.resolve(name+'/package.json');return {name,version:JSON.parse(fs.readFileSync(pkg)).version,manifestSha256:hash(fs.readFileSync(pkg))};}),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify(summary)+'\n');
