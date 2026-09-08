/** Static resource links and first-move path simulations. Never load application/build code. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {root,packet,emit} from './census.mjs';
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const ledger=read('source-ledger.json'),graph=read('dependency-ledger.json'),owners=read('owner-boundaries.json'),boundaries=read('boundary-review.json');
const {parse}=createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT,'package.json'))('@babel/parser');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=new Map(),tracked=new Map(ledger.files.map(f=>[f.path,f]));
function source(file){const text=fs.readFileSync(path.join(root,file),'utf8');inputs.set(file,{path:file,sha256:hash(text)});return text;}
function at(file,token){const text=source(file),offset=text.indexOf(token);assert.ok(offset>=0,'Missing resource anchor: '+file+':'+token);return {path:file,line:text.slice(0,offset).split('\n').length,anchor:token};}
const incoming=file=>graph.edges.filter(e=>e.target===file).map(e=>({edge:e.id,path:e.from,line:e.line}));
const resourceSuffix=/\.(?:svg|png|jpe?g|webp|gif|avif|ico|bmp|ttf|otf|woff2?|eot|wasm|glsl|frag|vert|css|scss|sass|mp[34]|wav|ogg|webm|pdf|ya?ml|json|xml|txt)(?:[?#]|$)/i;
const resourceLiteral=value=>resourceSuffix.test(value)||/\.[cm]?js(?:[?#]|$)/i.test(value);
const assetMeta=file=>{const f=tracked.get(file);return f?{path:file,source:f.id,sha256:f.sha256,mode:f.mode,bytes:f.bytes}:null;};
const relative=(from,spec)=>path.posix.normalize(path.posix.join(path.posix.dirname(from),spec.split(/[?#]/)[0]));
function literalResource(from,value){
  if(typeof value!=='string')return {kind:'computed',target:null};
  if(/^(?:https?:|wss?:|data:|blob:|\/\/)/i.test(value))return {kind:'external-or-inline',valueHash:hash(value),target:null};
  const clean=value.split(/[?#]/)[0];
  if(clean.startsWith('/')){
    const f=assetMeta('frontend/public/'+clean.slice(1));
    return {kind:f?'public-file':'runtime-absolute-path',
      ...(f||/^\/(?:api|static|fonts|media|assets|content|crt-lab)\//.test(clean)?{value}:{valueHash:hash(value)}),target:f};
  }
  if(clean.startsWith('.'))return {kind:'source-relative',value,target:assetMeta(relative(from,value))};
  return {kind:'context-relative-or-package',value:resourceSuffix.test(value)?value:null,target:null};
}
const references=[],globs=[],moduleUrls=[],workers=[],parseErrors=[],poseBindings=[];
const jsFiles=ledger.files.filter(f=>f.mode!=='120000'&&/^(backend\/src|frontend\/src|shared|cli|scripts)\//.test(f.path)
  && /\.[cm]?[jt]sx?$/.test(f.path)&&!/(?:\.(?:test|spec)\.|\/(?:__tests__|__fixtures__)\/)/.test(f.path));
const name=n=>n?.name??n?.value;
for(const file of jsFiles){
  const text=source(file.path);let ast;
  try{ast=parse(text,{sourceType:'unambiguous',allowReturnOutsideFunction:true,plugins:['jsx',...(/\.tsx?$/.test(file.path)?['typescript']:[]),'decorators-legacy']});}
  catch(error){parseErrors.push({path:file.path,message:error.message});continue;}
  const loc=n=>({path:file.path,line:n.loc.start.line,endLine:n.loc.end.line});
  const ref=n=>n?{...loc(n),type:n.type}:null;
  const value=n=>n?.type==='StringLiteral'?n.value:n?.type==='TemplateLiteral'&&!n.expressions.length?n.quasis[0].value.cooked:null;
  function walk(n,parent){
    if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(x=>walk(x,parent));return;}
    if(n.type==='StringLiteral'&&resourceLiteral(n.value)&&!['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(parent?.type))
      references.push({...loc(n),syntax:'literal-resource',...literalResource(file.path,n.value)});
    if(n.type==='TemplateLiteral'&&n.expressions.length&&resourceLiteral(n.quasis.map(q=>q.value.cooked||'').join('')))
      references.push({...loc(n),syntax:'computed-resource-template',kind:'computed',target:null,expression:ref(n)});
    if(n.type==='CallExpression'&&n.callee?.type==='MemberExpression'&&name(n.callee.property)==='glob'
      &&n.callee.object?.type==='MetaProperty'&&n.callee.object.meta.name==='import'){
      const pattern=value(n.arguments[0]);assert.ok(pattern&&/^\.\/[^*]+\/\*\.svg$/.test(pattern),'Unreviewed glob shape: '+file.path);
      const prefix=relative(file.path,pattern.slice(0,-5));
      const matches=ledger.files.filter(f=>f.path.startsWith(prefix)&&f.path.endsWith('.svg')&&!f.path.slice(prefix.length).includes('/')).map(f=>assetMeta(f.path));
      const options=n.arguments[1]?.properties?.map(p=>({key:name(p.key),value:p.value?.value??null}))||[];
      globs.push({...loc(n),pattern,options,matches,consumers:incoming(file.path),policy:'Exact direct-child SVG expansion from frozen tracked baseline; generated/untracked matches excluded and must be checked at candidate build.'});
    }
    if(n.type==='NewExpression'&&name(n.callee)==='URL'&&n.arguments[1]?.type==='MemberExpression'
      &&n.arguments[1].object?.type==='MetaProperty'&&name(n.arguments[1].property)==='url'){
      const spec=value(n.arguments[0]);
      moduleUrls.push({...loc(n),specifier:spec,sourceTarget:spec?relative(file.path,spec):null,arguments:n.arguments.map(ref)});
    }
    if(n.type==='NewExpression'&&['Worker','SharedWorker'].includes(name(n.callee)))workers.push({...loc(n),constructor:name(n.callee),arguments:n.arguments.map(ref),consumers:incoming(file.path)});
    if(n.type==='MemberExpression'&&n.object?.type==='MetaProperty'&&name(n.property)==='url')
      references.push({...loc(n),syntax:'import-meta-url',kind:'module-location',target:null});
    if(n.type==='JSXAttribute'&&['src','srcSet','href','poster'].includes(name(n.name)))
      references.push({...loc(n),syntax:'jsx-resource-attribute',attribute:name(n.name),kind:'value-source',expression:ref(n.value),target:null});
    if(n.type==='CallExpression'&&['fetch','fileURLToPath','createRequire'].includes(name(n.callee)))
      references.push({...loc(n),syntax:'resource-or-location-call',operation:name(n.callee),kind:'arguments-source',arguments:n.arguments.map(ref),target:null});
    if(file.path==='frontend/src/modules/Fitness/domain/pose/PoseDetectorService.js'&&n.type==='VariableDeclarator'&&n.id?.type==='ArrayPattern'
      &&n.init?.type==='AwaitExpression'&&n.init.argument?.arguments?.[0]?.type==='ArrayExpression'){
      const calls=n.init.argument.arguments[0].elements;
      if(calls.every(c=>c?.callee?.type==='Import'))poseBindings.push({...loc(n),bindings:calls.map((c,i)=>({position:i,import:value(c.arguments[0]),local:n.id.elements[i]?.name||null}))});
    }
    for(const [k,v]of Object.entries(n))if(!['loc','start','end','comments','tokens'].includes(k))walk(v,n);
  }
  walk(ast.program,null);
}
assert.equal(parseErrors.length,0,'Resource AST parse failures');assert.equal(globs.length,4,'Review new/removed SVG glob catalogs');
for(const g of globs)assert.ok(g.matches.length,'Empty reviewed SVG glob: '+g.path);
const styles=[],styleUrls=[],styleDirectives=[];
const aliasSource=at('frontend/vite.config.js',"'@gaming-ui': path.resolve(__dirname, 'src/modules/Gaming/platform/ui')");
for(const file of ledger.files.filter(f=>f.mode!=='120000'&&/\.(scss|sass|css)$/.test(f.path)&&/^(frontend|shared|backend)\//.test(f.path))){
  const text=source(file.path),clean=text.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' ')).replace(/^[ \t]*\/\/[^\n]*$/gm,m=>' '.repeat(m.length));
  for(const m of clean.matchAll(/@(use|forward|import)\s+([^;\n]+)/g))styleDirectives.push({path:file.path,line:clean.slice(0,m.index).split('\n').length,
    directive:m[1],syntax:/^['"]/.test(m[2])?'quoted':/^url\(/.test(m[2])?'url':'computed-or-unsupported',
    multiImport:/['"]\s*,\s*['"]/.test(m[2])});
  for(const m of clean.matchAll(/@(use|forward|import)\s+['"]([^'"]+)['"]/g)){
    const spec=m[2],alias=spec.startsWith('@gaming-ui/'),base=alias?'frontend/src/modules/Gaming/platform/ui/'+spec.slice('@gaming-ui/'.length):relative(file.path,spec),dir=path.posix.dirname(base),leaf=path.posix.basename(base);
    const candidates=[base,path.posix.join(dir,'_'+leaf),...['.scss','.sass','.css'].flatMap(ext=>[base+ext,path.posix.join(dir,'_'+leaf+ext),path.posix.join(base,'_index'+ext),path.posix.join(base,'index'+ext)])];
    styles.push({path:file.path,line:clean.slice(0,m.index).split('\n').length,directive:m[1],
      ...(/^(?:https?:|\/\/)/.test(spec)?{specifierHash:hash(spec)}:{specifier:spec}),
      candidates:[...new Set(candidates)].map(assetMeta).filter(Boolean),
      aliasSource:alias?aliasSource:null,
      kind:/^(sass:|https?:|url\()/.test(spec)?'builtin-or-external':'relative-or-package',
      limitation:'Static quoted first-specifier resolution only; compiler load paths, aliases, interpolation and multi-import syntax remain separate source/compile checks'});
  }
  for(const m of clean.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g))styleUrls.push({path:file.path,line:clean.slice(0,m.index).split('\n').length,...literalResource(file.path,(m[1]??m[2]??m[3]).trim())});
}
const importResources=graph.edges.filter(e=>resourceSuffix.test(e.specifier||'')).map(e=>({edge:e.id,path:e.from,line:e.line,specifier:e.specifier,kind:e.kind,target:e.target?assetMeta(e.target):null}));
const publicFiles=ledger.files.filter(f=>f.path.startsWith('frontend/public/')).map(f=>({ ...assetMeta(f.path),publicUrl:'/'+f.path.slice('frontend/public/'.length),
  consumers:[...references,...styleUrls].filter(r=>r.target?.path===f.path).map(r=>({path:r.path,line:r.line})),
  policy:'Retain root-relative public URL and bytes through first migration; Vite copies public tree separately from module imports'}));
const proposedPaths=new Map([...owners.moves.map(m=>[m.old,m.new]),...boundaries.files.filter(f=>f.proposedPath).map(f=>[f.path,f.proposedPath])]);
const fontRoot='backend/assets/fonts',candidateFontRoot='platform/server/assets/fonts';
const fontPaths=moduleUrls.filter(r=>r.sourceTarget?.startsWith(fontRoot)).map(r=>{
  const newModule=proposedPaths.get(r.path)||r.path,candidateTarget=candidateFontRoot+r.sourceTarget.slice(fontRoot.length);
  let newRelative=path.posix.relative(path.posix.dirname(newModule),candidateTarget);if(!newRelative.startsWith('.'))newRelative='./'+newRelative;
  return {...r,newModule,unchangedLiteralAfterMove:relative(newModule,r.specifier),candidateTarget,requiredLiteralIfFontsMove:newRelative,
    decision:'Conditional exact rewrite; bundled asset authority relocation still needs approval. Runtime overrides never move with source.'};
});
assert.equal(fontPaths.length,3,'Bundled font path consumer count changed');
const fontAssets=ledger.files.filter(f=>f.path.startsWith(fontRoot+'/')).map(f=>({...assetMeta(f.path),candidate:candidateFontRoot+f.path.slice(fontRoot.length)}));
const dockerText=source('docker/Dockerfile'),ignoreText=source('.dockerignore');
const copies=[...dockerText.matchAll(/^COPY\s+(.+)$/gm)].map(m=>({line:dockerText.slice(0,m.index).split('\n').length,tokens:m[1].split(/\s+/),
  note:'Declared source/destination/ownership only; actual context matching is not simulated with Git ignore semantics'}));
const ignoreRules=ignoreText.split('\n').flatMap((raw,i)=>raw.trim()&&!raw.trim().startsWith('#')?[{line:i+1,pattern:raw.trim(),negated:raw.trim().startsWith('!')}]:[]);
// The raw scanner intentionally records broad configuration/path strings. For
// the selected Gratitude/shared closure, classify every computed or
// context-relative resource-looking value explicitly so a later source change
// cannot silently turn a storage/generated value into an assumed bundled asset.
const selectedResourcePaths=new Set([...owners.moves.map(m=>m.old),...owners.foundation.map(f=>f.path)]);
const selectedComputedReferences=references.filter(ref=>selectedResourcePaths.has(ref.path)
  && ['computed','context-relative-or-package'].includes(ref.kind));
const selectedComputedDispositions={
  'backend/src/0_system/utils/FileIO.mjs:46':{
    kind:'derived-yaml-suffix',
    authority:'caller-supplied base path; FileIO primitive contract',
    preserve:'Try .yml before .yaml; this is not a source asset or fixed namespace.'},
  'backend/src/0_system/utils/FileIO.mjs:49':{
    kind:'derived-yaml-suffix',
    authority:'caller-supplied base path; FileIO primitive contract',
    preserve:'Try .yaml only after .yml; this is not a source asset or fixed namespace.'},
  'backend/src/0_system/utils/FileIO.mjs:159':{
    kind:'derived-yaml-suffix',
    authority:'caller-supplied base path; FileIO primitive contract',
    preserve:'Append .yml only when the caller supplied no extension.'},
  'backend/src/0_system/utils/FileIO.mjs:683':{
    kind:'derived-yaml-suffix',
    authority:'caller-supplied base path; FileIO primitive contract',
    preserve:'Delete the .yml sibling as one of two current attempts.'},
  'backend/src/0_system/utils/FileIO.mjs:684':{
    kind:'derived-yaml-suffix',
    authority:'caller-supplied base path; FileIO primitive contract',
    preserve:'Delete the .yaml sibling as one of two current attempts.'},
  'backend/src/0_system/utils/FileIO.mjs:974':{
    kind:'generated-image-output',
    authority:'injected baseDir/folder/uid at invocation',
    preserve:'Write a direct <uid>.jpg output under caller-owned media path; no bundled image is selected.'},
  'backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs:60':{
    kind:'household-storage-key',
    authority:'STORE-GR-ARRAYS',
    preserve:'Read gratitude/<key>.yml through the supplied household DataService scope.'},
  'backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs:70':{
    kind:'household-storage-key',
    authority:'STORE-GR-ARRAYS',
    preserve:'Write gratitude/<key>.yml through the supplied household DataService scope.'},
  'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs:14':{
    kind:'temporary-render-output',
    authority:'STORE-GR-PRINT-TEMP',
    preserve:'OS-temporary PNG name is scoped by the injected clock and cleaned up best-effort after printer use.'},
  'backend/src/1_rendering/gratitude/gratitudeCardTheme.mjs:37':{
    kind:'font-dir-relative-name',
    authority:'configured or bundled font-directory capability',
    preserve:'Renderer resolves this name against injected fontDir; retain the named face and fallback behavior.'},
  'frontend/src/modules/Admin/Apps/GratitudeConfig.jsx:22':{
    kind:'editable-config-example',
    authority:'household gratitude configuration',
    preserve:'Placeholder only; it neither imports nor guarantees a source/public icon asset.'},
  'frontend/src/modules/Admin/utils/adminConfigPaths.js:43':{
    kind:'derived-household-config-path',
    authority:'shared/contracts/householdConfig.mjs and admin config API allowlist',
    preserve:'Derive household/<registered-path>.yml; this is a data authority, not a browser resource URL.'},
};
const selectedComputedKeys=selectedComputedReferences.map(ref=>`${ref.path}:${ref.line}`).sort();
assert.deepEqual(selectedComputedKeys,Object.keys(selectedComputedDispositions).sort(),
  'Selected computed resource references changed; add an explicit disposition');
const selectedComputed=selectedComputedReferences.map(ref=>({...ref,disposition:selectedComputedDispositions[`${ref.path}:${ref.line}`]}));
const anchors={
  fontOverride:at('backend/src/app.mjs',"fontDir: configService.getPath('font') || `${mediaBasePath}/fonts`"),
  gratitudeFontOverride:at('backend/src/app.mjs','const renderer = createGratitudeCardRenderer({'),
  fontFallback:at('backend/src/1_rendering/lib/CanvasFactory.mjs','const DEFAULT_FONT_DIR ='),
  avatarRewrite:at('frontend/src/lib/api.mjs',"if (path.startsWith('static/img/'))"),
  genericImageRoute:at('backend/src/4_api/v1/routers/static.mjs',"router.get('/img/*splat'"),
  typedUserRoute:at('backend/src/4_api/v1/routers/static.mjs',"router.get('/users/:id'"),
  imageRepository:at('backend/src/1_adapters/persistence/files/FilesystemStaticImageRepository.mjs','if (kind === \'user\')'),
  staticComposition:at('backend/src/5_composition/modules/staticApi.mjs','export function createStaticApiRouter'),
  spa:at('backend/src/app.mjs','app.use(express.static(frontendPath'),
  vite:at('frontend/vite.config.js','export default defineConfig'),
  wasm:at('frontend/src/modules/Fitness/domain/pose/PoseDetectorService.js','setWasmPaths'),
  stockfish:at('backend/src/1_adapters/chess/loadStockfish.mjs',"export function loadEngineFactory(variant = 'lite-single')")
};
const workerBindings=[
  {file:'backend/src/1_adapters/chess/StockfishEngineAdapter.mjs',worker:'stockfishWorker.mjs',owner:'Chess capability; also composed by Piano Games',injection:'createStockfishEngine({ workerPath })',integration:'backend/src/app.mjs and backend/src/5_composition/modules/pianoGames.mjs',testControl:'StockfishEngineAdapter.test.mjs supplies an intentionally missing or boot-failing worker path',contract:'search/abandon and ready/bestmove/boot-failed; Stockfish lite-single JS/WASM package bytes'},
  {file:'backend/src/1_adapters/chess/StockfishAnalysisAdapter.mjs',worker:'stockfishAnalysisWorker.mjs',owner:'Chess review capability',injection:'createStockfishAnalyst({ workerPath })',integration:'backend/src/app.mjs and chess calibration/review CLIs',testControl:'adapter consumer/CLI coverage; package/load identity remains a build experiment',contract:'analyse and ready/analysis/boot-failed; shared loadStockfish helper and native module scope'},
  {file:'backend/src/1_adapters/piano-games/ConnectFourEngineAdapter.mjs',worker:'connectFourWorker.mjs',owner:'Piano Games experience using shared gaming rules',injection:'createConnectFourEngine({ workerPath })',integration:'backend/src/5_composition/modules/pianoGames.mjs',testControl:'ConnectFourEngineAdapter.test.mjs; shared SerializedWorkerOpponent owns timeout/correlation mechanics',contract:'Shared serialized opponent passes search/abandon; worker uses shared gaming engine source'},
  {file:'backend/src/1_adapters/piano-games/CheckersEngineAdapter.mjs',worker:'checkersWorker.mjs',owner:'Piano Games experience using shared gaming rules',injection:'createCheckersEngine({ workerPath })',integration:'backend/src/5_composition/modules/pianoGames.mjs',testControl:'CheckersEngineAdapter.test.mjs; shared SerializedWorkerOpponent owns timeout/correlation mechanics',contract:'Shared serialized opponent passes search/abandon; worker uses shared gaming engine source'},
  {file:'backend/src/1_adapters/school/rubiksCube/KociembaCubeRecoverySolver.mjs',worker:'kociembaWorker.mjs',owner:'School Rubik\'s Cube experience using shared gaming rules',injection:'new KociembaCubeRecoverySolver({ workerPath })',integration:'backend/src/app.mjs',testControl:'KociembaCubeRecoverySolver.test.mjs; package/native identity remains a build experiment',contract:'id/facelets to ok/moves/error response; cubejs package solver'}
].map(({file,worker,...binding})=>({source:at(file,"path.join(HERE, '"+worker+"')"),worker:assetMeta(relative(file,'./'+worker)),...binding,
  imports:graph.edges.filter(e=>e.from===relative(file,'./'+worker)).map(e=>({edge:e.id,specifier:e.specifier,target:e.target})),
  consumers:incoming(file),policy:'Preserve source-relative default and configurable workerPath override. Worker not started by this inventory.'}));
assert.ok(workerBindings.every(w=>w.worker),'Missing worker source');
const schoolIconRoot=at('backend/src/1_adapters/school/documents/FilesystemSchoolAssetResolver.mjs',"'../../../../../frontend/src/modules/School/home/icons/svg'");
const shader=graph.edges.find(e=>e.from==='frontend/src/modules/Player/lib/crtRenderer.js'&&e.specifier.includes('.glsl?raw'));
assert.ok(shader,'Missing Player raw shader import');
const nativeResources={poseBindings,
  poseBindingFinding:'Five imports are destructured into three variables: tfBackendWasm receives webgl and poseDetection receives wasm. Source names do not prove intended model/WASM activation; no incidental fix authorized.',
  wasm:publicFiles.filter(f=>f.path.endsWith('.wasm')),
  shader:{edge:shader.id,path:shader.from,specifier:shader.specifier,tracked:assetMeta('frontend/src/modules/Player/shaders/crt-geom.glsl')},
  schoolIconRoot,schoolIconFiles:globs.find(g=>g.path.endsWith('/home/icons/iconRegistry.js')).matches,
  policy:'Source-shipped School icons are consumed by backend PDF as well as browser glob. Public WASM/fonts and module raw shader have distinct deployment mechanisms.'};
const htmlReferences=[];
for(const file of ledger.files.filter(f=>f.mode!=='120000'&&f.path.startsWith('frontend/')&&f.path.endsWith('.html'))){
  const text=source(file.path),clean=text.replace(/<!--[\s\S]*?-->/g,m=>m.replace(/[^\n]/g,' '));
  for(const m of clean.matchAll(/\b(src|href|poster)\s*=\s*['"]([^'"]+)['"]|url\(\s*['"]([^'"]+)['"]\s*\)/g))
    htmlReferences.push({path:file.path,line:clean.slice(0,m.index).split('\n').length,syntax:m[1]||'css-url',...literalResource(file.path,m[2]||m[3])});
}
const manifests=['frontend/public/manifest.json','frontend/public/feed-manifest.json'].map(file=>{
  const m=JSON.parse(source(file));return {path:file,startUrl:m.start_url,scope:m.scope,
    icons:(m.icons||[]).map(i=>({...i,...literalResource(file,i.src)})),
    shortcuts:(m.shortcuts||[]).map(s=>({url:s.url,icons:(s.icons||[]).map(i=>({...i,...literalResource(file,i.src)}))})),
    missingTrackedIcons:(m.icons||[]).filter(i=>!literalResource(file,i.src).target).map(i=>i.src),
    policy:'Missing tracked PNG icons are a source/build provenance gap, not proof of deployed HTTP status.'};
});
const installedShell={
  entry:at('frontend/index.html','src="/src/main.jsx"'),
  copiedLegacyHtml:assetMeta('frontend/public/index.html'),
  legacyHtmlPolicy:'Separate tracked CRA-era public/index.html is not the Vite source entry. Actual build output collision/order must be checked, not guessed or cleaned up incidentally.',
  htmlReferences,manifests,
  serviceWorker:{registration:at('frontend/index.html',"navigator.serviceWorker.register('/sw.js', { scope: '/' })"),
    script:at('frontend/public/sw.js',"const SHELL_CACHE = 'daylight-shell-v2'"),
    cache:'Root shell cache daylight-shell-v2; initial URLs / and /manifest.json; max 120 insertion-ordered entries.',
    requestPolicy:'Same-origin GET only; /api/ and /media/ prefixes bypass. Navigation is network-first with cached / only on rejection; successful navigation refreshes /.',
    assetPolicy:'Only script/style/font/image destinations; hash-shaped /assets URLs use cache-first, stable names network-first with cache fallback on rejection, not non-OK HTTP status.',
    lifecycle:'Install caches shell then skipWaiting; activate removes older daylight-shell-* caches and claims clients; cacheCopy clones synchronously before handing body to consumer.'},
  retiredFeedWorker:{script:at('frontend/public/feed-sw.js',"self.addEventListener('fetch', () => {})"),
    cleanup:at('frontend/src/Apps/FeedApp.jsx',"script.includes('/feed-sw.js')"),
    policy:'Tracked legacy worker is no-op; FeedApp unregisters matching old script/scope. Do not re-register merely because the file exists.'},
  bootRecovery:{source:at('frontend/index.html',"var ATTEMPT_KEY = 'daylight.boot.attempt'"),
    behavior:'Boot-only SCRIPT/LINK/error/empty-root trap; root content disarms and removes panel. Backoff retries with sessionStorage/window.name counter; third-and-later retry unregisters origin service workers and deletes caches before reload with bounded wait.',
    scope:'Existing shell behavior, not a new app-owned storage namespace or proof of loaded-client recovery.'}
};
emit('resource-review.json',{schema:'daylight.preimplementation.resource-review/v1',baseline:ledger.baseline,
  parsedFiles:jsFiles.length,parseErrors,importResources,references,selectedComputed,styles,styleUrls,styleDirectives,globs,moduleUrls,workers,workerBindings,nativeResources,installedShell,publicFiles,fontAssets,fontPaths,anchors,
  docker:{copies,ignoreRules,missingCandidateCopies:['modules/','capabilities/','platform/'],
    policy:'Candidate root manifests must reach install layers before npm ci; source/assets before frontend build. Extensions remain separately built and excluded. Exact engine context/in-image checks remain build proof, not inferred from these declarations.'},
  remaining:['Adjudicate computed/context-relative resources and nonstandard Sass import forms; raw indexes are not compiler parity.',
    'Worker defaults, helpers, consumer integrations and injectable test controls are paired here. Configured font/resource roots still need equivalent consumer-path adjudication before a move affecting them.',
    'Exact Docker engine context selection, native/image identities, lazy chunks and loaded-client recovery require isolated build experiments.'],
  inputs:[...inputs.values()],inventoryInputs:['source-ledger.json','dependency-ledger.json','owner-boundaries.json','boundary-review.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({parsedFiles:jsFiles.length,importResources:importResources.length,references:references.length,selectedComputed:selectedComputed.length,styleImports:styles.length,styleUrls:styleUrls.length,
  globs:globs.map(g=>({path:g.path,matches:g.matches.length})),workers:workers.length,publicFiles:publicFiles.length,fontPaths})+'\n');
