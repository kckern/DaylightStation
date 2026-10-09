import {ti86NativeSelected,ti86NativeCaseCount,ti86GuiSelected,ti86GuiDisabledName,ti86RelaySelected} from '../configs/ti86-native-selected.mjs';
import {stageTi86Fixtures} from './stage-ti86-fixtures.mjs';
import {retainedVitest,retainedNode,retainedTi86Vitest,retainedTi86Unrun} from '../configs/retained-supplement-selected.mjs';
import {remainingVitestSelections,remainingNode,remainingJest,remainingHttpSupported} from '../configs/remaining-selected.mjs';
import {agentsLifeConciergeVitest,agentsLifeHttpVitest} from '../configs/agents-life-concierge-selected.mjs';
import {contentApiVitest} from '../configs/content-api-selected.mjs';
/** Fixed Linux baseline adapter: no installs, runtime entrypoint, candidate or shell commands. */
import fs from 'node:fs';
import {gamingNotationVitest,gamingNotationNode,gamingSupplemental} from '../configs/gaming-notation-selected.mjs';
import {botsDisplaysVitest,botsDisplaysNode,botsDisplaysJest} from '../configs/bots-displays-selected.mjs';
import {mediaContentVitest,mediaContentNode,mediaContentJest} from '../configs/media-content-selected.mjs';
import {m2Selected} from '../configs/m2-selected.mjs';
import {healthStackSelected,healthCliSupplemental,healthCliSupplementalCaseCount} from '../configs/health-stack-selected.mjs';
import {healthSelected} from '../configs/health-selected.mjs';
import {schoolFitnessSelected} from '../configs/school-fitness-selected.mjs';
const extraSelections={'retained-ti86-relay':ti86RelaySelected,'retained-ti86-gui':ti86GuiSelected,'retained-ti86-native':ti86NativeSelected,'media-presentation':['modules/media/browser/content-filter/videoPresentation.test.jsx'],'retained-ti86':retainedTi86Vitest,'retained-supplement':retainedVitest,'retained-supplement-node':retainedNode,'art-canvas':['tests/isolated/adapter/persistence/files/FilesystemCanvasImageRepository.test.mjs'],'piano-retained-node':['backend/src/3_applications/devices/services/PianoMidiWakeService.test.mjs','backend/src/3_applications/devices/services/PianoBridgeSupervisorService.test.mjs','backend/src/5_composition/modules/pianoBridgeSupervisor.test.mjs'],'art-screens':["tests/unit/art/screensList.test.mjs", "tests/unit/art/screensPreset.test.mjs", "tests/isolated/adapter/persistence/files/FilesystemScreensRepository.test.mjs"],'progress-store':["backend/src/1_adapters/persistence/yaml/YamlUserVideoProgressStore.test.mjs", "tests/isolated/application/school/materialProgressStore.test.mjs", "modules/piano/server/api/piano.economyHook.test.mjs"],'remaining-stockfish':['backend/src/1_adapters/chess/StockfishEngineAdapter.test.mjs'],'agents-life-config':['tests/isolated/agents/framework/loadAgentConfig.test.mjs'],...remainingVitestSelections,'remaining-http':remainingHttpSupported,'remaining-node':remainingNode,'remaining-jest':remainingJest,'agents-life-diagnostic':['tests/isolated/adapters/agents/MastraAdapter.modern.test.mjs','backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs'],'agents-life-concierge':agentsLifeConciergeVitest,'agents-life-http':agentsLifeHttpVitest,'content-api':contentApiVitest,'gaming-notation':gamingNotationVitest,'gaming-notation-node':gamingNotationNode,'bots-displays':botsDisplaysVitest,'media-content':mediaContentVitest,'bots-displays-node':botsDisplaysNode,'media-content-node':mediaContentNode,'bots-displays-jest':botsDisplaysJest,'media-content-jest':mediaContentJest};
const nodePacks=['retained-supplement-node','piano-retained-node','remaining-node','gaming-notation-node','bots-displays-node','media-content-node'];const jestPacks=['remaining-jest','bots-displays-jest','media-content-jest'];
const hubFailureSignatures={
 'mapLaneToSnapshot maps a playing lane to a valid playing SessionSnapshot':'AssertionError: expected { valid: false, …(1) } to deeply equal { valid: true, errors: [] }',
 'mapLaneToSnapshot maps paused and idle lanes':'AssertionError: expected false to be true // Object.is equality',
 'HubFleetBridge broadcasts a valid device-state envelope per lane on first snapshot':'AssertionError: expected { valid: false, …(1) } to deeply equal { valid: true, errors: [] }',
 'HubStatusBroadcaster after 3 consecutive failures, backoff sequence matches expected schedule':'AssertionError: expected 0 to be greater than or equal to 3',
};
function exactHubFailures(assertions){const failures=assertions.filter(a=>a.status==='failed');return failures.length===4&&failures.every(a=>Object.hasOwn(hubFailureSignatures,a.fullName)&&a.failureMessages?.length===1&&a.failureMessages[0].split('\n    at ')[0]===hubFailureSignatures[a.fullName]);}
const producerFailureNames=["Producer catalog certification accepts a fully reconciled catalog at the production minimums", "Producer catalog certification rejects an indexed groove that contains no playable notes", "Producer catalog certification rejects an unledgered manifest file even when the file itself parses", "Producer catalog certification rejects dead prefab refs and an exceeded manifest-build budget", "Producer catalog certification rejects prefab structure that would silently disappear during runtime hydration", "Producer prefab curation repairs the indexed lofi starter and preserves the original in its backup", "Producer prefab curation validates references and applies new payloads only after a backup"];
const remainingFixturePacks=['remaining-feed','remaining-camera','remaining-games','remaining-workflows','remaining-media-tools'];
const nextPacks=[...Object.keys(extraSelections),'epaper-http'];
const vitestPacks=['retained-ti86-relay','retained-ti86-gui','retained-ti86-native','media-presentation','retained-ti86','retained-supplement','art-canvas','art-screens','progress-store','remaining-stockfish','agents-life-config','remaining-http',...Object.keys(remainingVitestSelections),'agents-life-diagnostic','agents-life-concierge','agents-life-http','content-api','gaming-notation','stored-shape','integration','m2','health','health-stack','school-fitness','bots-displays','media-content'];

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fs.realpathSync(new URL('../../../../',import.meta.url));
const tests=path.join(root,'tests/preimplementation/application-modules');
if (process.platform!=='linux' || process.arch!=='x64') throw new Error('Linux x86_64 required');
const pack=process.argv[2];
if (process.argv.length!==3 || !['gratitude','browser','stored-shape','integration','m2','health','health-stack','school-fitness','school-http',...nextPacks].includes(pack)) throw new Error('Only fixed gratitude/browser/stored-shape packs are implemented');
const selectedBrowserProfile=['integration','m2','school-fitness','health-stack',...nextPacks].includes(pack);
const boundedLongProfile=['school-fitness','health-stack',...nextPacks].includes(pack);
const target=process.env.PRE_TARGET||'baseline';
if(!['baseline','candidate'].includes(target) || target==='candidate'&&!['gratitude','browser','m2','health','health-stack','school-fitness','school-http',...nextPacks].includes(pack)) throw new Error('Only Gratitude/browser candidate targets are implemented');
let baseline=null,baselineFile='';
if(target==='candidate'){
 if(!process.env.PRE_BASELINE_EVIDENCE) throw new Error('Prior green Gratitude baseline receipt required');
 baselineFile=fs.realpathSync(process.env.PRE_BASELINE_EVIDENCE);
 baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
 if(baseline.target!=='baseline'||baseline.pack!==pack||(baseline.exitCode!==0&&!((pack==='retained-supplement-node'&&baseline.knownFailureCharacterization?.matched&&baseline.exitCode===1&&baseline.passed?.length===134&&JSON.stringify(baseline.failed)===JSON.stringify(producerFailureNames))||(pack==='remaining-media-tools'&&baseline.knownFailureCharacterization?.matched&&baseline.exitCode===1&&baseline.passed?.length===413&&exactHubFailures(baseline.vitest?.testResults.flatMap(file=>file.assertionResults)||[]))))||!baseline.controls||!baseline.protectedInputsUnchanged||(nextPacks.includes(pack)?!baseline.passed?.length:baseline.passed?.length!==({gratitude:59,m2:145,'school-http':8,health:165,'school-fitness':471,'health-stack':146,browser:25}[pack]))||(baseline.failed?.length&&!['remaining-media-tools','retained-supplement-node'].includes(pack))||baseline.incomplete) throw new Error('Invalid prior green selected-pack baseline');
}
if (!process.env.PRE_TOOLCHAIN_ROOT) throw new Error('Explicit PRE_TOOLCHAIN_ROOT required');
const toolRoot=fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const evidence=path.join(root,'.superpowers/sdd/2026-10-08-gratitude-module-proof/landlock-runs');
fs.mkdirSync(evidence,{recursive:true});
const directory=fs.mkdtempSync(path.join(evidence,pack+'-'));
const scratch=path.join(directory,'scratch'),denied=path.join(directory,'denied');
fs.mkdirSync(scratch); fs.mkdirSync(denied);
let selectedMoves={};
if(target==='candidate'&&nextPacks.includes(pack)){
 if(!process.env.PRE_SELECTED_MOVES)throw new Error('Reviewed source move map required');
 selectedMoves=JSON.parse(fs.readFileSync(process.env.PRE_SELECTED_MOVES,'utf8'));
 fs.writeFileSync(path.join(scratch,'selected-moves.json'),JSON.stringify(selectedMoves));
}
const ti86Relay=pack==='retained-ti86-relay';
const ti86Gui=pack==='retained-ti86-gui';
const ti86Native = pack==='retained-ti86-native'||ti86Gui;
const artifactSourceRoot=(ti86Native||ti86Relay)&&target==='baseline'?fs.realpathSync(process.env.PRE_TI86_ORIGINAL_ROOT):root;
const selectedFiles=[...(extraSelections[pack]||(pack==='health-stack'?healthStackSelected:[])),...(target==='candidate'&&pack==='health-stack'?healthCliSupplemental:[]),...(target==='candidate'&&pack==='art-canvas'?['modules/art/tests/composition/installed-runtime.test.mjs']:[]),...(target==='candidate'&&pack==='gaming-notation'?gamingSupplemental:[]),...(target==='candidate'&&pack==='media-content'?['capabilities/content-catalog/server/adapters/providers/plex/PlexAdapter.curriculumEnrichment.test.mjs','backend/src/5_composition/integrations/providerOwnership.test.mjs','modules/media/browser/content-filter/videoPresentation.test.jsx']:[])].map(file=>{const destination=Object.hasOwn(selectedMoves,file)?selectedMoves[file]:file;if(typeof destination!=='string'||path.isAbsolute(destination)||destination.split(/[\\/]/).includes('..')||!destination.match(/\.test\.(mjs|js|jsx)$/))throw new Error('Unsafe fixed selected oracle');return path.join((ti86Native||ti86Relay)&&target==='baseline'?artifactSourceRoot:root,destination);});
let artifactStage=null;
if(pack==='retained-ti86'||ti86Native||ti86Relay){const inventory=spawnSync('/usr/bin/git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});if(inventory.status!==0)throw new Error('Artifact inventory failed');artifactStage=stageTi86Fixtures({root:artifactSourceRoot,scratch,toolRoot,tracked:(ti86Native||ti86Relay)&&target==='baseline'?JSON.parse(fs.readFileSync(path.join(artifactSourceRoot,'tracked-files.json'),'utf8')):inventory.stdout.split('\0').filter(Boolean),selected:selectedFiles.map(file=>path.relative(artifactSourceRoot,file))});fs.writeFileSync(path.join(scratch,'artifact-stage.json'),JSON.stringify(artifactStage));}
let nativeTool=null;
if(ti86Native){
 const proof=JSON.parse(fs.readFileSync(process.env.PRE_Z80ASM_BUILD_RECEIPT,'utf8'));
 const archiveProof=JSON.parse(fs.readFileSync(path.join(path.dirname(process.env.PRE_Z80ASM_BUILD_RECEIPT),'archive-verification.json'),'utf8'));
 const bytes=fs.readFileSync(proof.binary),digest=createHash('sha256').update(bytes).digest('hex');
 if(proof.exitCode!==0||proof.installed||proof.downloadedBuildScriptsExecuted||digest!==proof.binarySha256||archiveProof.sha256!=='67fba9940582cddfa70113235818fb52d81e5be3db483dfb0816acb330515f64')throw new Error('Authentic pinned native tool proof required');
 const bin=path.join(scratch,'native-bin');fs.mkdirSync(bin);fs.writeFileSync(path.join(bin,'z80asm'),bytes,{mode:0o755});
 nativeTool={archive:archiveProof,binarySha256:digest,buildReceipt:fs.realpathSync(process.env.PRE_Z80ASM_BUILD_RECEIPT),stagedBinary:path.join(bin,'z80asm'),installation:false};
}
const sentinel=path.join(denied,'private.env');
fs.writeFileSync(sentinel,'synthetic private sentinel\n');
const forbidden=new Set(['backend/index.js','backend/src/app.mjs','backend/src/5_composition/bootstrap.mjs']);
const git=spawnSync('/usr/bin/git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
if(git.status!==0) throw new Error('Tracked source enumeration failed');
const scope=(pack==='browser'||selectedBrowserProfile)?/^(frontend\/src|backend\/src|shared)\/.+\.(mjs|js|cjs|jsx|scss|css|svg|glsl|glslp)$/:/^(backend\/src|shared)\/.+\.(mjs|js|cjs)$/;
const source=git.stdout.split('\0').filter(name=>scope.test(name) && !forbidden.has(name)).map(name=>path.join(root,name)).filter(file=>fs.existsSync(file));
if(pack.startsWith('retained-supplement'))source.push(...git.stdout.split('\0').filter(file=>/^_extensions\/(fitness|ticalc-relay)\/.+\.(mjs|js|cjs|json)$/.test(file)&&fs.existsSync(path.join(root,file))).map(file=>path.join(root,file)));
const caseFile=vitestPacks.includes(pack)?path.join(root,'tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs'):path.join(tests,'cases/'+pack+'.case.mjs');
if(['integration','m2','health','health-stack','school-fitness'].includes(pack)) source.push(...git.stdout.split('\0').filter(n=>/^(tests\/(isolated|unit)|backend\/src)\/.+\.(mjs|js|jsx)$/.test(n)&&fs.existsSync(path.join(root,n))).map(n=>path.join(root,n)));
if(pack==='m2')source.push(path.join(root,'tests/_infrastructure/frontend-env.mjs'),...m2Selected.map(file=>path.join(root,file)));
if(boundedLongProfile)source.push(path.join(root,'tests/_infrastructure/frontend-env.mjs'),...(pack==='school-fitness'?schoolFitnessSelected:healthStackSelected).map(file=>path.join(root,file)));
if(pack==='health')source.push(path.join(root,'modules/nutribot/server/application/lib/scalePrompts.mjs'),...healthSelected.map(file=>path.join(root,file)));
if(pack==='health-stack')source.push(...healthStackSelected.map(file=>path.join(root,file)),...git.stdout.split('\0').filter(n=>/^cli\/.+\.(mjs|js|json)$/.test(n)&&fs.existsSync(path.join(root,n))).map(n=>path.join(root,n)));
if(fs.existsSync(path.join(root,'tests/_fixtures/nutrition/foodPrompts.mjs')))source.push(path.join(root,'tests/_fixtures/nutrition/foodPrompts.mjs'));
for(const file of ['frontend/src/lib/input/ActionBus.js','frontend/src/lib/widgets/WidgetRegistry.js','frontend/src/composition/school/teacher.jsx','backend/src/3_applications/common/ports/IAsyncScheduler.mjs','backend/src/2_domains/midi/MidiRecordingStoneCodec.mjs','frontend/src/components/AiMark/index.jsx','frontend/src/components/AiMark/AiMark.scss','cli/piano-producer-migrate.cli.mjs','backend/src/5_composition/policies/contentRequiresCamera.mjs','backend/src/0_system/persistence/YamlUserAppRecordStore.mjs','backend/src/0_system/utils/safePathSegment.mjs','backend/src/3_applications/common/ports/IResponseContext.mjs','backend/src/3_applications/agents/framework/userWorkingMemoryTemplate.mjs','backend/src/0_system/scheduling/ProgressWriteRuntime.mjs','backend/src/5_composition/contentRegistry.mjs','backend/src/5_composition/modules/contentApi.mjs','backend/src/5_composition/modules/printableSheets.mjs','backend/src/5_composition/modules/weeklyMeasures.mjs','backend/src/5_composition/integrations/providerManifests.mjs','backend/src/5_composition/integrations/providerOwnership.test.mjs','tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt'])if(fs.existsSync(path.join(root,file)))source.push(path.join(root,file));
source.push(path.join(tests,'configs/m2-selected.mjs'),path.join(tests,'configs/health-selected.mjs'),path.join(tests,'configs/health-stack-selected.mjs'),path.join(tests,'configs/school-fitness-selected.mjs'));
if(boundedLongProfile)source.push(...git.stdout.split('\0').filter(n=>/^tests\/(_lib|_fixtures|_infrastructure)\/.+\.(mjs|js|jsx|json|ya?ml|svg|png)$/.test(n)&&fs.existsSync(path.join(root,n))).map(n=>path.join(root,n)));
if(['health-stack','gaming-notation-node',...remainingFixturePacks].includes(pack))source.push(path.join(tests,'tooling/health-scratch-fs.mjs'));
if(pack==='remaining-http')source.push(path.join(tests,'tooling/health-scratch-fs.mjs'),path.join(tests,'tooling/remaining-fixture-controls.mjs'),path.join(tests,'tooling/proxy-transport-controls.mjs'));
if(pack==='gaming-notation-node')source.push(path.join(tests,'tooling/gaming-scratch-fs.mjs'));
source.push(path.join(root,'modules/nutribot/server/application/lib/scalePrompts.mjs'),caseFile,fileURLToPath(import.meta.url),path.join(root,'backend/src/0_system/libraries/gratitudeRuntime.mjs'));
if(nextPacks.includes(pack))source.push(...selectedFiles.filter(file=>file.startsWith(root+path.sep)),path.join(root,'tests/_infrastructure/frontend-env.mjs'),path.join(root,'babel.config.js'),...git.stdout.split('\0').filter(n=>/^(cli|tests\/(_lib|_fixtures|_infrastructure))\/.+\.(mjs|js|jsx|json|ya?ml|svg|png)$/.test(n)&&fs.existsSync(path.join(root,n))).map(n=>path.join(root,n)));
for(const name of fs.readdirSync(path.join(tests,'configs')))if(/\.(mjs|cjs)$/.test(name))source.push(path.join(tests,'configs',name));
// Owner surfaces contain the reviewed source moved from the original runtime roots.
// Enumerate individual code/assets only: never grant whole owners or dependency links.
const ownerSourceFiles=[];
const ownerSkip=new Set(['node_modules','.git','.cache','.vite','dist','build','coverage','vendor']);
for(const parent of ['modules','capabilities']) {
 const parentDirectory=path.join(root,parent);
 for(const owner of fs.readdirSync(parentDirectory,{withFileTypes:true})) {
  if(!owner.isDirectory()||owner.isSymbolicLink())continue;
  for(const surface of ['server','browser','portable','cli','satellites']) {
   const directory=path.join(parentDirectory,owner.name,surface);
   if(!fs.existsSync(directory)||fs.lstatSync(directory).isSymbolicLink())continue;
   const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
    if(ownerSkip.has(item.name)||item.isSymbolicLink())continue;
    const file=path.join(dir,item.name);
    if(item.isDirectory())walk(file);
    else if(item.isFile()&&/\.(mjs|js|cjs|jsx|scss|css|svg|glsl|glslp)$/.test(item.name))ownerSourceFiles.push(file);
   }};
   walk(directory);
  }
 }
}
source.push(...ownerSourceFiles,path.join(tests,'tooling/stage-ti86-fixtures.mjs'));
for(const directory of ['frontend/src/composition/screens','frontend/src/composition/gaming','frontend/src/lib/diagnostics']) {
 const full=path.join(root,directory);
 if(!fs.existsSync(full))continue;
 const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isSymbolicLink()||ownerSkip.has(item.name))continue;const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.(mjs|js|jsx|scss|css|svg|glsl)$/.test(item.name))source.push(file);}};
 walk(full);
}
if(target==='candidate'&&nextPacks.includes(pack)) {
 const inventory=new Set(source.map(file=>path.relative(root,file)));
 const missing=Object.values(selectedMoves).filter(file=>/\.(mjs|js|cjs|jsx)$/.test(file)&&fs.existsSync(path.join(root,file))&&!forbidden.has(file)&&!inventory.has(file));
 // Retained tests are granted separately by selectedFiles; private runtime source must
 // already be in the explicit source inventory before starting a confined child.
 const missingRuntime=missing.filter(file=>!/(?:^tests\/|\.(?:test|spec|case)\.)/.test(file));
 if(missingRuntime.length)throw new Error('Candidate destination source grant preflight failed: '+missingRuntime.join(', '));
 fs.writeFileSync(path.join(scratch,'candidate-source-preflight.json'),JSON.stringify({mappedSources:Object.values(selectedMoves).length,ownerSources:ownerSourceFiles.length,missingRuntime},null,2));
}
for(const file of ['tests/isolated/rendering/school/golden/corpus/fraction-strips.svg','backend/src/2_domains/camera/fixtures/search-doorbell-2026-07-17.json','backend/src/2_domains/camera/fixtures/search-nvr-ch1-2026-07-17.json','backend/src/2_domains/camera/fixtures/search-driveway-2026-07-17.json','frontend/public/arcade-film.html','capabilities/music-notation/browser/scores/maryHadALittleLamb.musicxml','capabilities/music-notation/browser/__fixtures__/maryHadALittleLamb.musicxml']){const destination=Object.hasOwn(selectedMoves,file)?selectedMoves[file]:file;if(fs.existsSync(path.join(root,destination)))source.push(path.join(root,destination));}
if(vitestPacks.includes(pack)) source.push(path.join(tests,'configs/vitest.config.mjs'));
for(const name of fs.readdirSync(path.join(tests,'drivers'))) if(/\.(mjs|js|jsx|scss|css|svg|glsl)$/.test(name)) source.push(path.join(tests,'drivers',name));
const grants=new Map();
const retainedCorpusFiles=git.stdout.split('\0').filter(file=>file.startsWith('tests/_fixtures/exercise-library/')&&fs.existsSync(path.join(root,file))).map(file=>path.join(root,file));
if(pack.startsWith('retained-supplement')){if(retainedCorpusFiles.length!==22)throw new Error('Exact22 retained exercise fixture files required');for(const file of [...retainedCorpusFiles,path.join(root,'tests/fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid')]){source.push(file);grants.set(fs.realpathSync(file),'F');for(let dir=path.dirname(file);dir.startsWith(root);dir=path.dirname(dir))grants.set(dir,'L');}for(const name of ['health-scratch-fs.mjs','retained-scratch-fs.mjs','retained-copy-controls.mjs']){const file=path.join(tests,'tooling',name);source.push(file);grants.set(file,'F');}}
const schoolFixtureSources=git.stdout.split('\0').filter(file=>/^tests\/_fixtures\/school\/curriculum\/(units|documents|manifests|banks)\/[^/]+\.yml$/.test(file)).map(file=>path.join(root,file));schoolFixtureSources.push(path.join(root,'tests/isolated/rendering/school/golden/corpus/fraction-strips.svg'));
if(['health-stack','remaining-camera','remaining-http'].includes(pack))grants.set(fs.realpathSync('/usr/share/zoneinfo/America/Los_Angeles'),'F');
for(const file of source){
  const canonical=fs.realpathSync(file);
  if(!canonical.startsWith(root+path.sep)) throw new Error('Source symlink outside worktree refused');
  grants.set(canonical,'F');
}
for(const scope of ['','backend','frontend']){
  grants.set(fs.realpathSync(path.join(root,scope,'package.json')),'F');
  grants.set(fs.realpathSync(path.join(toolRoot,scope,'package.json')),'F');
  grants.set(fs.realpathSync(path.join(toolRoot,scope,'node_modules')),'D');
}
if(vitestPacks.includes(pack)||selectedBrowserProfile) for(const file of source) for(let dir=path.dirname(file);dir.startsWith(root);dir=path.dirname(dir)) grants.set(dir,'L');
if(vitestPacks.includes(pack)||selectedBrowserProfile) grants.set(fs.realpathSync('/lib/x86_64-linux-gnu/librt.so.1'),'F');
if(vitestPacks.includes(pack)) grants.set(fs.realpathSync(path.join(toolRoot,'node_modules/@esbuild/linux-x64/bin/esbuild')),'X');
if(pack==='browser') grants.set(fs.realpathSync(path.join(toolRoot,'frontend/node_modules/@esbuild/linux-x64/bin/esbuild')),'X');
if(selectedBrowserProfile){
 for(const lib of ['libuuid.so.1','libresolv.so.2'])grants.set(fs.realpathSync('/lib/x86_64-linux-gnu/'+lib),'F');
 source.push(path.join(root,'backend/assets/fonts/roboto-condensed/RobotoCondensed-Regular.ttf'));
 grants.set(fs.realpathSync(source.at(-1)),'F');
 fs.writeFileSync(path.join(scratch,'fonts.conf'),'<fontconfig><cachedir>'+scratch+'/font-cache</cachedir></fontconfig>');
}
if(selectedBrowserProfile) for(const scope of ['','frontend']){
 grants.set(fs.realpathSync(path.join(toolRoot,scope,'node_modules/@esbuild/linux-x64/bin/esbuild')),'X');
 const dart=path.join(toolRoot,scope,'node_modules/sass-embedded-linux-x64/dart-sass/src/dart');if(fs.existsSync(dart))grants.set(fs.realpathSync(dart),'X');
}
if(boundedLongProfile){
 for(const file of git.stdout.split('\0').filter(n=>/^backend\/assets\/fonts\/.+\.(ttf|otf)$/.test(n))){source.push(path.join(root,file));grants.set(fs.realpathSync(path.join(root,file)),'F');}
 grants.set(fs.realpathSync('/usr/bin/pdftotext'),'X');
 const libraries=spawnSync('/usr/bin/ldd',['/usr/bin/pdftotext'],{encoding:'utf8',timeout:5000});
 if(libraries.status!==0)throw new Error('Fixed pdftotext library enumeration failed');
 for(const match of libraries.stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm))grants.set(fs.realpathSync(match[1]),'F');
}
if((['m2','school-fitness','health-stack'].includes(pack)||nextPacks.includes(pack))&&!grants.has(fs.realpathSync(path.join(root,'tests/_infrastructure/frontend-env.mjs'))))throw new Error('Selected browser environment missing exact source grant');
if(ti86Gui){
 for(const name of ['ti86-release-copy.mjs','health-scratch-fs.mjs']){const file=path.join(tests,'tooling',name);source.push(file);grants.set(file,'F');}
 fs.writeFileSync(path.join(scratch,'ti86-release-preload.mjs'),`import fs from 'node:fs';import {installTi86ReleaseCopy} from ${JSON.stringify(new URL('./ti86-release-copy.mjs',import.meta.url).href)};const fixture=installTi86ReleaseCopy({scratchRoot:process.env.PRE_RUN_ROOT,artifactRoot:process.env.PRE_RUN_ROOT+'/artifact-source/'+(process.env.PRE_TARGET==='baseline'?'_extensions/ti86-app':'modules/school/satellites/ti86-app')});process.once('exit',()=>{fs.appendFileSync(process.env.PRE_RUN_ROOT+'/release-copy-observations.jsonl',JSON.stringify(fixture.controls)+'\\n');fixture.restore();});`);
}
if(pack==='retained-ti86'){for(const name of ['health-scratch-fs.mjs','ti86-scratch-copy.mjs']){const file=path.join(tests,'tooling',name);source.push(file);grants.set(file,'F');}fs.writeFileSync(path.join(scratch,'ti86-copy-preload.mjs'),`import fs from 'node:fs';import {installTi86ScratchCopy} from ${JSON.stringify(new URL('./ti86-scratch-copy.mjs',import.meta.url).href)};const copy=installTi86ScratchCopy({scratchRoot:process.env.PRE_RUN_ROOT});process.once('exit',()=>{fs.appendFileSync(process.env.PRE_RUN_ROOT+'/ti86-copy-observations.jsonl',JSON.stringify(copy.controls)+'\\n');copy.restore();});`);}
const manifest=path.join(directory,'read-allowlist.tsv');
const entries=[...grants].sort(([a],[b])=>a.localeCompare(b));
if(entries.some(([p])=>/[\r\n\t]/.test(p))) throw new Error('Unsafe manifest pathname');
fs.writeFileSync(manifest,entries.map(([p,t])=>`${t}\t${p}\n`).join(''));
fs.writeFileSync(path.join(scratch,'openssl.cnf'),'');
if(selectedBrowserProfile)fs.writeFileSync(path.join(scratch,'styles.css'),'');
if(selectedBrowserProfile)fs.writeFileSync(path.join(scratch,'vitest-setup.mjs'),`import {afterEach,expect} from 'vitest';import * as matchers from ${JSON.stringify('file://'+path.join(toolRoot,'frontend/node_modules/@testing-library/jest-dom/dist/matchers.mjs'))};expect.extend(matchers);if(typeof document!=='undefined'){const {cleanup}=await import(${JSON.stringify('file://'+path.join(toolRoot,'frontend/node_modules/@testing-library/react/dist/index.js'))});afterEach(cleanup);}`);

if(pack==='retained-supplement'){fs.appendFileSync(path.join(scratch,'vitest-setup.mjs'),`\nimport fs from 'node:fs';import {afterAll} from 'vitest';import {installRetainedScratchFsAdapter} from ${JSON.stringify(new URL('./retained-scratch-fs.mjs',import.meta.url).href)};const retained=installRetainedScratchFsAdapter({scratchRoot:process.env.PRE_RUN_ROOT,readOnlyFixtures:${JSON.stringify(retainedCorpusFiles)}});afterAll(()=>{fs.appendFileSync(process.env.PRE_RUN_ROOT+'/retained-copy-observations.jsonl',JSON.stringify(retained.controls)+'\\n');retained.restore();});`);}
if(pack==='health-stack'){
 fs.copyFileSync(path.join(tests,'tooling/health-scratch-fs.mjs'),path.join(scratch,'health-scratch-fs.mjs'));
 fs.appendFileSync(path.join(scratch,'vitest-setup.mjs'),`\nimport fs from 'node:fs';import {afterAll} from 'vitest';import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';const fixture=installHealthScratchFsAdapter({scratchRoot:process.env.PRE_RUN_ROOT});afterAll(()=>{fs.appendFileSync(process.env.PRE_RUN_ROOT+'/health-fs-adapter.jsonl',JSON.stringify(fixture.controls)+'\\n');fixture.restore();});`);
}
if(remainingFixturePacks.includes(pack)){
 fs.writeFileSync(path.join(scratch,'health-scratch-fs.mjs'),fs.readFileSync(path.join(tests,'tooling/health-scratch-fs.mjs')));
 const fixtures=git.stdout.split('\0').filter(file=>(/^tests\/_fixtures\/school\/curriculum\/(units|documents|manifests|banks)\/[^/]+\.yml$/).test(file)&&fs.existsSync(path.join(root,file))).map(file=>path.join(root,file));
 fixtures.push(path.join(root,'tests/isolated/rendering/school/golden/corpus/fraction-strips.svg'));if(fixtures.length!==18)throw new Error('Exact eighteen School fixture sources required');
 fs.appendFileSync(path.join(scratch,'vitest-setup.mjs'),`\nimport fs from 'node:fs';import {afterAll} from 'vitest';import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';const fixture=installHealthScratchFsAdapter({scratchRoot:process.env.PRE_RUN_ROOT,fixtureFamily:'remaining',readOnlyFixtures:${JSON.stringify(fixtures)}});afterAll(()=>{fs.appendFileSync(process.env.PRE_RUN_ROOT+'/remaining-fs-adapter.jsonl',JSON.stringify(fixture.controls)+'\\n');fixture.restore();});`);
}
if(remainingFixturePacks.includes(pack)&& (schoolFixtureSources.length!==18||schoolFixtureSources.some(file=>grants.get(fs.realpathSync(file))!=='F')))throw new Error('School checked-copy source/grant preflight requires all eighteen exact sources');
const uuidManifest=JSON.parse(fs.readFileSync(path.join(toolRoot,'backend/node_modules/uuid/package.json'),'utf8'));
const nativeUuid=path.join(toolRoot,'backend/node_modules/uuid',uuidManifest.exports['.'].node.import);
const nativeCode=`const assert=require('node:assert/strict'); (async()=>{
 const owner=await import(${JSON.stringify('file://'+path.join(root,'modules/gratitude/server/public.mjs'))});
 const bridge=await import(${JSON.stringify('file://'+path.join(root,'backend/src/0_system/libraries/gratitudeRuntime.mjs'))});
 const uuid=await import(${JSON.stringify('file://'+nativeUuid)});
 const moment=await import(${JSON.stringify('file://'+path.join(toolRoot,'backend/node_modules/moment-timezone/index.js'))});
 assert.equal(bridge.uuidv4,uuid.v4); assert.equal(bridge.moment,moment.default);
 assert.deepEqual(Object.keys(owner).sort(),['createGratitudeApiRouter','createGratitudeServices']);
 ${pack==='health'?`for(const facet of ['nutrition-records','scale-config','scale-weight']){const entry=await import(${JSON.stringify('file://'+path.join(root,'modules/health/server/'))}+facet+'.mjs');assert.ok(Object.keys(entry).length);}`:''}
 ${pack==='school-fitness'||pack==='school-http'?`const school=await import(${JSON.stringify('file://'+path.join(root,'modules/school/server/teacher-runtime.mjs'))});const fitness=await import(${JSON.stringify('file://'+path.join(root,'modules/fitness/server/services.mjs'))});assert.equal(typeof school.createTeacherAuthorization,'function');assert.equal(typeof fitness.createFitnessServices,'function');`:''}
 ${pack==='m2'?`const piano=await import(${JSON.stringify('file://'+path.join(root,'modules/piano/server/composition.mjs'))});const playback=await import(${JSON.stringify('file://'+path.join(root,'capabilities/playback/server/public.mjs'))});assert.equal(typeof piano.createPianoModule,'function');assert.equal(typeof playback.PlaybackSessionRegistry,'function');assert.equal(typeof playback.ReportPlaybackSession,'function');`:''}
 process.stdout.write('NATIVE PUBLIC ESM PASS');
})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
const healthCliNativeCode=`import assert from 'node:assert/strict';
const originalParent=${JSON.stringify('file://'+path.join(root,'cli/curate-nutrition-icons.mjs'))};
const ownerParent=${JSON.stringify('file://'+path.join(root,'modules/health/cli/curate-nutrition-icons.mjs'))};
const rows=[];
for(const specifier of ['uuid','dotenv','js-yaml']){
 const original=import.meta.resolve(specifier,originalParent),owned=import.meta.resolve(specifier,ownerParent);
 assert.equal(owned,original,specifier+' original root ESM import-condition identity');
 assert.ok(owned.startsWith(${JSON.stringify('file://'+path.join(toolRoot,'node_modules')+'/')}),specifier+' canonical root dependency');
 const api=await import(owned);
 if(specifier==='uuid')assert.equal(typeof api.v4,'function');
 if(specifier==='dotenv')assert.equal(typeof (api.config??api.default?.config),'function');
 if(specifier==='js-yaml')assert.deepEqual((api.load??api.default?.load)('synthetic: true'),{synthetic:true});
 rows.push({specifier,original,owned,importConditions:true,imported:true,commandLoaded:false,environmentLoaded:false});
}
process.stdout.write(JSON.stringify(rows));`;
const controlSource=caseFile;
const entry=path.join(scratch,'entry.mjs');
fs.writeFileSync(entry,`import fs from 'node:fs';

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const sentinel=${JSON.stringify(sentinel)}, source=${JSON.stringify(controlSource)};
const denied=(name,fn)=>{assert.throws(fn,e=>['EACCES','EPERM'].includes(e.code),name); process.stdout.write('CONTROL '+name+': denied\\n');};
fs.writeFileSync('permitted.txt','scratch only\\n'); assert.equal(fs.readFileSync('permitted.txt','utf8'),'scratch only\\n');
denied('outside read',()=>fs.readFileSync(sentinel));
denied('outside write',()=>fs.writeFileSync(sentinel,'changed'));
denied('outside truncate',()=>fs.truncateSync(sentinel,0));
denied('source write',()=>fs.openSync(source,'w'));
denied('source truncate',()=>fs.truncateSync(source,0));
denied('host read',()=>fs.readFileSync('/etc/hostname'));
fs.symlinkSync(sentinel,'escape');
denied('symlink read',()=>fs.readFileSync('escape'));
denied('symlink write',()=>fs.writeFileSync('escape','changed'));
if (${JSON.stringify(pack)}==='gratitude') {
  assert.equal(spawnSync(process.execPath,['-e','process.exit(0)']).error?.code,'EPERM');
} else {
  const childCode="const fs=require('node:fs'),assert=require('node:assert/strict'),net=require('node:net'); const deny=fn=>assert.throws(fn,e=>['EACCES','EPERM'].includes(e.code)); deny(()=>fs.readFileSync("+JSON.stringify(sentinel)+")); deny(()=>fs.writeFileSync("+JSON.stringify(sentinel)+",'changed')); deny(()=>fs.readFileSync('/etc/hostname')); const server=net.createServer(); server.on('error',e=>{assert.equal(e.code,'EPERM'); process.stdout.write('CHILD CONTROLS PASS');}); server.listen(0);";
  const child=spawnSync(process.execPath,['--openssl-config=openssl.cnf','-e',childCode],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr+JSON.stringify({error:child.error?.message,signal:child.signal})); assert.equal(child.stdout,'CHILD CONTROLS PASS');
  process.stdout.write('CHILD CONTROLS PASS\\n');
  const native=spawnSync(process.execPath,['--openssl-config=openssl.cnf','-e',${JSON.stringify(nativeCode)}],{encoding:'utf8'});
  assert.equal(native.status,0,native.stderr); assert.equal(native.stdout,'NATIVE PUBLIC ESM PASS');
  process.stdout.write('NATIVE PUBLIC ESM PASS\\n');
}

${pack==='health-stack'&&target==='candidate'?`const healthCliNative=spawnSync(process.execPath,['--openssl-config=openssl.cnf','--experimental-import-meta-resolve','--input-type=module','-e',${JSON.stringify(healthCliNativeCode)}],{encoding:'utf8'});assert.equal(healthCliNative.status,0,healthCliNative.stderr);const healthCliNativeRows=JSON.parse(healthCliNative.stdout);assert.equal(healthCliNativeRows.length,3);fs.writeFileSync('health-cli-native-resolution.json',JSON.stringify(healthCliNativeRows));process.stdout.write('HEALTH CLI NATIVE ESM PASS\\n');`:''}
process.stdout.write('CONTROLS PASS\\n');
if(${JSON.stringify(selectedBrowserProfile)})process.env.FONTCONFIG_FILE=process.env.PRE_RUN_ROOT+'/fonts.conf';
${target==='candidate'&&nextPacks.includes(pack)?`process.env.PRE_SELECTED_MOVES=process.env.PRE_RUN_ROOT+'/selected-moves.json';`:''}
${target==='candidate'&&pack==='gratitude'?`const owner=await import(${JSON.stringify('file://'+path.join(root,'modules/gratitude/server/public.mjs'))});
const raw=[{item:'legacy synthetic quote'}], reads=[];
const owned=owner.createGratitudeServices({dataService:{household:{read:p=>{reads.push(p);return raw;},write(){}}},logger:{}});
assert.equal(owned.readSelectionQuotes(),raw); assert.deepEqual(reads,['gratitude/selections.gratitude.yml']);
const args=['household','gratitude','alex',[{text:'synthetic'}],'timestamp'], result={synthetic:true};
owned.gratitudeService.addSelections=(...actual)=>{assert.deepEqual(actual,args);return result;};
assert.equal(owned.addSelections(...args),result);
assert.deepEqual(Object.keys(owner).sort(),['createGratitudeApiRouter','createGratitudeServices']);
process.stdout.write('CANDIDATE OWNER CONTROLS PASS\\n');`:''}

${pack==='retained-ti86'?`const ti86Controls=(await import(${JSON.stringify(new URL('./ti86-scratch-copy.mjs',import.meta.url).href)})).assertTi86ScratchCopyControls({scratchRoot:process.env.PRE_RUN_ROOT});fs.writeFileSync('ti86-copy-controls.json',JSON.stringify(ti86Controls));`:''}
${pack.startsWith('retained-supplement')?`const retainedControls=await (await import(${JSON.stringify(new URL('./retained-copy-controls.mjs',import.meta.url).href)})).assertRetainedCopyControls({scratchRoot:process.env.PRE_RUN_ROOT});fs.writeFileSync('retained-copy-controls.json',JSON.stringify(retainedControls));`:''}
${pack==='retained-supplement-node'?`const retained= (await import(${JSON.stringify(new URL('./retained-scratch-fs.mjs',import.meta.url).href)})).installRetainedScratchFsAdapter({scratchRoot:process.env.PRE_RUN_ROOT});process.once('exit',()=>{fs.appendFileSync(process.env.PRE_RUN_ROOT+'/retained-copy-observations.jsonl',JSON.stringify(retained.controls)+'\\n');retained.restore();});`:''}
${pack==='remaining-http'?`const fixtureControls=(await import(${JSON.stringify(new URL('./remaining-fixture-controls.mjs',import.meta.url).href)})).assertRemainingFixtureControls({scratchRoot:process.env.PRE_RUN_ROOT});fs.writeFileSync('remaining-fixture-controls.json',JSON.stringify(fixtureControls));const proxyControls=await (await import(${JSON.stringify(new URL('./proxy-transport-controls.mjs',import.meta.url).href)})).assertProxyTransportControls();fs.writeFileSync('proxy-controls.json',JSON.stringify(proxyControls));await (await import(${JSON.stringify(new URL('../drivers/remaining-http-request.mjs',import.meta.url).href)})).assertRemainingWireControls();`:''}
${ti86Native?`process.env.PATH=process.env.PRE_RUN_ROOT+'/native-bin';const asm=spawnSync(process.env.PATH+'/z80asm',['--version'],{encoding:'utf8'});assert.equal(asm.status,0,asm.stderr);fs.writeFileSync('native-probe.asm','call 1234h\\n');const assembled=spawnSync(process.env.PATH+'/z80asm',['-o','native-probe.bin','native-probe.asm'],{encoding:'utf8'});assert.equal(assembled.status,0,assembled.stderr);assert.deepEqual([...fs.readFileSync('native-probe.bin')],[0xcd,0x34,0x12]);fs.writeFileSync('native-tool-probe.json',JSON.stringify({version:asm.stderr||asm.stdout,actualBytes:[...fs.readFileSync('native-probe.bin')],assemblerSha256:${JSON.stringify(nativeTool?.binarySha256)}}));`:''}
${ti86Gui?`const releaseCopyControls=(await import(${JSON.stringify(new URL('./ti86-release-copy.mjs',import.meta.url).href)})).assertTi86ReleaseCopyControls({scratchRoot:process.env.PRE_RUN_ROOT});fs.writeFileSync('release-copy-controls.json',JSON.stringify(releaseCopyControls));const releaseRoot=${JSON.stringify(path.join(artifactStage?.stage||'',target==='baseline'?'_extensions/ti86-app':'modules/school/satellites/ti86-app'))};const releaseBuilds=[];for(const name of ['build-schoolcalc-shell.mjs','build-ti86a-provisioning.mjs']){const built=spawnSync(process.execPath,[releaseRoot+'/tools/'+name],{encoding:'utf8'});releaseBuilds.push({name,status:built.status,signal:built.signal,stdout:built.stdout,stderr:built.stderr});fs.writeFileSync('release-builds.json',JSON.stringify(releaseBuilds));assert.equal(built.status,0,built.stderr);}const crypto=await import('node:crypto');fs.writeFileSync('release-artifacts.json',JSON.stringify(['SCHLCALC.86p','DSUSERS.86s','DSPROG.86s'].map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(releaseRoot+'/dist/'+name)).digest('hex'),bytes:fs.statSync(releaseRoot+'/dist/'+name).size}))));`:''}
${vitestPacks.includes(pack)?`process.env.PRE_VITEST_MODE=${JSON.stringify(pack)};process.env.HOME=process.env.PRE_RUN_ROOT;process.env.OPENSSL_CONF=process.env.PRE_RUN_ROOT+'/openssl.cnf';if(${JSON.stringify(selectedBrowserProfile)})process.env.FONTCONFIG_FILE=process.env.PRE_RUN_ROOT+'/fonts.conf';process.argv=[process.execPath,${JSON.stringify(path.join(toolRoot,'node_modules/vitest/vitest.mjs'))},'run','--reporter=default','--reporter=json','--outputFile='+${JSON.stringify(path.join(scratch,'vitest-result.json'))},'--config',${JSON.stringify(path.join(tests,'configs/vitest.config.mjs'))},'--configLoader','native']; await import(${JSON.stringify('file://'+path.join(toolRoot,'node_modules/vitest/vitest.mjs'))});`:`await import(${JSON.stringify(new URL('../cases/'+pack+'.case.mjs',import.meta.url).href)});`}
`);
const c=path.join(tests,'tooling/landlock-runner.c'),binary=path.join(directory,'landlock-runner');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs=[...new Set([...source,c,fileURLToPath(import.meta.url),entry,...entries.filter(([,t])=>t==='F'||t==='X').map(([p])=>p)])].sort().map(file=>({file,sha256:hash(file)}));
const compile=spawnSync('/usr/bin/gcc',['-O2','-Wall','-Wextra','-Werror',c,'-o',binary],{encoding:'utf8',timeout:30000,env:{PATH:'/usr/bin:/bin'}});
if(compile.status!==0) throw new Error('Launcher compile failed: '+compile.stderr);
const args=[scratch,fs.realpathSync(process.execPath),manifest,toolRoot,path.join(tests,'drivers/baseline-loader.mjs'),entry,denied,pack,target,baselineFile];
const watchdog=boundedLongProfile?'190s':'50s';
const result=spawnSync('/usr/bin/timeout',['--signal=KILL',watchdog,binary,...args],{cwd:root,encoding:'utf8',timeout:boundedLongProfile?195000:55000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin'}});
const output=fs.existsSync(path.join(scratch,'result.txt'))?fs.readFileSync(path.join(scratch,'result.txt'),'utf8'):'';
let passed=[...output.matchAll(/^ok \d+ - (CASE-[^\n]+)/gm)].map(m=>m[1]);
let failed=[...output.matchAll(/^not ok \d+ - (CASE-[^\n]+)/gm)].map(m=>m[1]);
let incomplete=['skipped','todo','cancelled'].some(key=>Number(output.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]||0)>0);
let vitest=null,jest=null,originalDisabledCases=[];
if(vitestPacks.includes(pack) && fs.existsSync(path.join(scratch,'vitest-result.json'))){
 vitest=JSON.parse(fs.readFileSync(path.join(scratch,'vitest-result.json'),'utf8'));
 const assertions=vitest.testResults.flatMap(result=>result.assertionResults);
 passed=assertions.filter(a=>a.status==='passed').map(a=>a.fullName);
 failed=assertions.filter(a=>a.status==='failed').map(a=>a.fullName);
 originalDisabledCases=ti86Gui?assertions.filter(a=>a.status==='skipped'&&a.fullName===ti86GuiDisabledName).map(a=>a.fullName):[];
 incomplete=(ti86Gui&&originalDisabledCases.length!==1)||vitest.testResults.some(result=>result.status==='failed'&&!result.assertionResults.length)||assertions.some(a=>!['passed','failed'].includes(a.status)&&!(ti86Gui&&a.status==='skipped'&&a.fullName===ti86GuiDisabledName)) || (pack==='stored-shape'?vitest.numTotalTests!==6:vitest.testResults.length!==(pack==='m2'?m2Selected.length:pack==='health'?healthSelected.length:pack==='health-stack'?healthStackSelected.length+(target==='candidate'?healthCliSupplemental.length:0):extraSelections[pack]?selectedFiles.length:boundedLongProfile?schoolFitnessSelected.length:10));
}
if(nodePacks.includes(pack)){
 passed=[];failed=[];const stack=[];
 for(const line of output.split('\n')){
  let match=line.match(/^(\s*)# Subtest: (.+)$/);
  if(match){const indent=match[1].length;while(stack.length&&stack.at(-1).indent>=indent)stack.pop();if(stack.length)stack.at(-1).children=true;stack.push({indent,name:match[2],parents:stack.map(f=>f.name),children:false});continue;}
  match=line.match(/^(\s*)(not ok|ok) \d+ - (.+)$/);
  if(match){const frame=stack.findLast(f=>f.indent===match[1].length);if(frame&&!frame.children)(match[2]==='ok'?passed:failed).push([...frame.parents,frame.name].join(' '));}
 }
 incomplete=incomplete||Number(output.match(/^# tests (\d+)$/m)?.[1])!==passed.length+failed.length|| (!['retained-supplement-node','piano-retained-node','gaming-notation-node','remaining-node'].includes(pack)&&passed.length+failed.length!==(pack==='bots-displays-node'?7:11));
}
if(jestPacks.includes(pack)){
 const file=path.join(scratch,pack+'-result.json');
 if(fs.existsSync(file)){jest=JSON.parse(fs.readFileSync(file,'utf8'));const assertions=jest.testResults.flatMap(test=>test.assertionResults);passed=assertions.filter(a=>a.status==='passed').map(a=>a.fullName);failed=assertions.filter(a=>a.status==='failed').map(a=>a.fullName);incomplete=!jest.success||assertions.some(a=>!['passed','failed'].includes(a.status))||jest.testResults.length!==selectedFiles.length||!fs.existsSync(path.join(scratch,pack+'-population.json'));}else incomplete=true;
}
if(nextPacks.includes(pack)||['m2','health','health-stack','school-fitness','school-http'].includes(pack)){passed.sort();failed.sort();}
let knownFailureCharacterization=pack==='remaining-media-tools'?{description:'Four unchanged preexisting PlaybackHub failures; failed statuses retained, not a green baseline',matched:result.status===1&&passed.length===413&&failed.length===4&&!incomplete&&exactHubFailures(vitest?.testResults.flatMap(file=>file.assertionResults)||[]),expected:hubFailureSignatures}:null;
if(pack==='retained-supplement-node')knownFailureCharacterization={description:'Seven preexisting Producer CLI semantic-source contract failures; original failed status retained',expectedNames:producerFailureNames,expectedMessage:'buildManifest requires a loop manifest source',matched:result.status===1&&!incomplete&&passed.length===134&&JSON.stringify(failed)===JSON.stringify(producerFailureNames)&&[...output.matchAll(/error: 'buildManifest requires a loop manifest source'/g)].length===7};
incomplete=incomplete||(result.status!==0&&!knownFailureCharacterization?.matched)||!passed.length;
const controls=output.includes('socket(AF_INET): EPERM\n') && (pack==='gratitude'?output.includes('fork: EPERM\n'):output.includes('CHILD CONTROLS PASS\n')) && output.includes('CONTROLS PASS\n') && (target!=='candidate'||pack!=='gratitude'||output.includes('CANDIDATE OWNER CONTROLS PASS\n')) && fs.readFileSync(sentinel,'utf8')==='synthetic private sentinel\n' && fs.readdirSync(denied).length===1;
const canonicalLibraries=[...output.matchAll(/^\{"canonicalLibrary":.*\}$/gm)].map(m=>JSON.parse(m[0]));
const nativePublicESM=output.includes('NATIVE PUBLIC ESM PASS\n');
const dependencyIdentity=target!=='candidate'||pack!=='gratitude'||['uuid','moment-timezone','express'].every(name=>canonicalLibraries.some(item=>item.canonicalLibrary===name&&item.resolved.startsWith(path.join(toolRoot,'backend/node_modules')+path.sep)));
const embedding=pack==='m2'?passed.filter(name=>name.includes('M2 embedding:')):[];
const compositionControls=boundedLongProfile?passed.filter(name=>name.includes('M3 composition:')):[];
const healthOwnershipControls=pack==='health'?passed.filter(name=>name==='nutrition capture ownership preserves first-use options and per-container capture service identity'):[];
const mediaEnrichmentControls=pack==='media-content'?passed.filter(name=>name==='M3 Plex enrichment preserves all three synchronous merge sites and the owned cache authority'||name==='M3 provider ownership preserves manifest order and injects the same Piano enrichment into generic Plex construction'):[];
const mediaPresentationControls=pack==='media-content'?passed.filter(name=>name==='installed Media playback presentation retains Player identities and applies the family filter with the same loading-store callbacks'):[];
const healthCliSupplementalCases=pack==='health-stack'&&target==='candidate'?(vitest?.testResults||[]).filter(file=>healthCliSupplemental.some(source=>path.join(root,source)===file.name)).flatMap(file=>file.assertionResults.filter(a=>a.status==='passed').map(a=>a.fullName)):[];
const artAssemblyControls=pack==='art-canvas'&&target==='candidate'?(vitest?.testResults||[]).filter(file=>file.name===path.join(root,'modules/art/tests/composition/installed-runtime.test.mjs')).flatMap(file=>file.assertionResults.filter(a=>a.status==='passed').map(a=>a.fullName)):[];
const gamingSupplementalCases=pack==='gaming-notation'&&target==='candidate'?vitest.testResults.filter(file=>gamingSupplemental.some(source=>path.join(root,source)===file.name)).flatMap(file=>file.assertionResults.filter(a=>a.status==='passed').map(a=>a.fullName)):[];
const parityPassed=passed.filter(name=>!healthCliSupplementalCases.includes(name)&&!gamingSupplementalCases.includes(name)&&!artAssemblyControls.includes(name)&&!mediaEnrichmentControls.includes(name)&&!mediaPresentationControls.includes(name)&&!embedding.includes(name)&&!compositionControls.includes(name)&&!healthOwnershipControls.includes(name));
const parity=baseline?parityPassed.length===baseline.passed.length && parityPassed.every((name,index)=>name===baseline.passed[index]) && (!failed.length||(knownFailureCharacterization?.matched&&baseline.knownFailureCharacterization?.matched&&JSON.stringify(failed)===JSON.stringify(baseline.failed))) && !incomplete:null;
const protectedInputsUnchanged=inputs.every(input=>hash(input.file)===input.sha256);
const remainingFixtureFile=path.join(scratch,'remaining-fs-adapter.jsonl');
const remainingFixtureAdaptation=remainingFixturePacks.includes(pack)?{description:'Named private scratch mtime overlays bound to inode/dev and verified byte/mode copies; no native metadata/copy parity',observations:fs.existsSync(remainingFixtureFile)?fs.readFileSync(remainingFixtureFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[]}:null;
const fixtureFile=path.join(scratch,'health-fs-adapter.jsonl');
const fixtureAdaptation=pack==='health-stack'?{kind:'synthetic scratch mtime overlay and actual exclusive byte/mode copy; no native metadata/copy parity',observations:fs.existsSync(fixtureFile)?fs.readFileSync(fixtureFile,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[]}:pack==='gaming-notation-node'?{kind:'actual checked async scratch byte/mode copy; no native copy/metadata parity',observations:fs.existsSync(path.join(scratch,'gaming-fs-adapter.json'))?[JSON.parse(fs.readFileSync(path.join(scratch,'gaming-fs-adapter.json'),'utf8'))]:[]}:null;
const wireControls=pack==='remaining-http'?['real Express error and missing-route finalhandler','binary/query/header/status','unchanged JSON','mismatched status/body rejected'].filter(name=>output.includes('WIRE CONTROL '+name+': PASS\n')):[];
const fixtureControls=pack==='remaining-http'&&fs.existsSync(path.join(scratch,'remaining-fixture-controls.json'))?JSON.parse(fs.readFileSync(path.join(scratch,'remaining-fixture-controls.json'),'utf8')):null;
const proxyControls=pack==='remaining-http'&&fs.existsSync(path.join(scratch,'proxy-controls.json'))?JSON.parse(fs.readFileSync(path.join(scratch,'proxy-controls.json'),'utf8')):[];
const retainedCopyControlsFile=path.join(scratch,'retained-copy-controls.json');const retainedCopyControls=fs.existsSync(retainedCopyControlsFile)?JSON.parse(fs.readFileSync(retainedCopyControlsFile)):null;const retainedCopyObservationFile=path.join(scratch,'retained-copy-observations.jsonl');const retainedCopyAdaptation=pack.startsWith('retained-supplement')?{description:'Checked actual byte/mode copies for three synthetic CLI families; exact22 readonly exercise fixtures, already-correct mode verification only; no native-copy/metadata mutation parity',controls:retainedCopyControls,observations:fs.existsSync(retainedCopyObservationFile)?fs.readFileSync(retainedCopyObservationFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[]}:null;
const ti86CopyControlsFile=path.join(scratch,'ti86-copy-controls.json'),ti86CopyObservationFile=path.join(scratch,'ti86-copy-observations.jsonl');const ti86CopyAdaptation=pack==='retained-ti86'?{description:'Observed journey-doc child copies real synthetic PNG bytes/mode within one named private fixture; no native-copy parity',controls:fs.existsSync(ti86CopyControlsFile)?JSON.parse(fs.readFileSync(ti86CopyControlsFile)):null,observations:fs.existsSync(ti86CopyObservationFile)?fs.readFileSync(ti86CopyObservationFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[]}:null;
const healthCliNativeResolutionFile=path.join(scratch,'health-cli-native-resolution.json');
const healthCliNativeResolution=pack==='health-stack'&&target==='candidate'&&fs.existsSync(healthCliNativeResolutionFile)?JSON.parse(fs.readFileSync(healthCliNativeResolutionFile,'utf8')):[];
const releaseArtifactParity=ti86Gui&&target==='candidate'?JSON.stringify(JSON.parse(fs.readFileSync(path.join(scratch,'release-artifacts.json'),'utf8')))===JSON.stringify(baseline.releaseArtifacts):null;
const report={relayExample:ti86Relay?JSON.parse(fs.readFileSync(path.join(root,'docs/_wip/plans/2026-10-09-calculator-relay-recovery.json'),'utf8')):null,releaseArtifactParity,releaseCopyControls:ti86Gui&&fs.existsSync(path.join(scratch,'release-copy-controls.json'))?JSON.parse(fs.readFileSync(path.join(scratch,'release-copy-controls.json'),'utf8')):null,releaseCopyObservations:ti86Gui&&fs.existsSync(path.join(scratch,'release-copy-observations.jsonl'))?fs.readFileSync(path.join(scratch,'release-copy-observations.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[],originalDisabledCases,recoveredGuiAssets:ti86Gui?JSON.parse(fs.readFileSync(path.join(root,'docs/_wip/plans/2026-10-09-calculator-gui-recovery.json'),'utf8')).files.filter(x=>x.restored):null,releaseBuilds:ti86Gui&&fs.existsSync(path.join(scratch,'release-builds.json'))?JSON.parse(fs.readFileSync(path.join(scratch,'release-builds.json'),'utf8')):null,releaseArtifacts:ti86Gui&&fs.existsSync(path.join(scratch,'release-artifacts.json'))?JSON.parse(fs.readFileSync(path.join(scratch,'release-artifacts.json'),'utf8')):null,nativeTool,nativeToolProbe:ti86Native&&fs.existsSync(path.join(scratch,'native-tool-probe.json'))?JSON.parse(fs.readFileSync(path.join(scratch,'native-tool-probe.json'),'utf8')):null,originalArtifactSourceRoot:artifactSourceRoot,healthCliSupplementalCases,healthCliNativeResolution,ti86CopyAdaptation,originalArtifactFilePopulation:pack==='retained-ti86'?retainedTi86Vitest.length+ti86NativeSelected.length+ti86GuiSelected.length+ti86RelaySelected.length+retainedTi86Unrun.length:null,artifactStage:artifactStage?{...artifactStage,originalInputBytesUnchanged:artifactStage.inputs.every(input=>hash(path.join(artifactSourceRoot,input.file))===input.sha256),stagedInputBytesUnchanged:artifactStage.inputs.every(input=>hash(path.join(artifactStage.stage,input.file))===input.sha256)}:null,unrunArtifactSuites:pack==='retained-ti86'?retainedTi86Unrun:null,retainedCopyAdaptation,schoolFixtureGrantPreflight:remainingFixturePacks.includes(pack)?schoolFixtureSources.map(file=>path.relative(root,file)):null,fixtureTimezone:pack==='remaining-http'?'America/Los_Angeles: matches explicit household date fixtures':null,proxyControls,knownFailureCharacterization,fixtureControls,remainingFixtureAdaptation,wireControls,workerPoolEvidence:pack.startsWith('agents-life-')?{pool:'forks',reference:'vitest.config.mjs:78-84',reason:'Fixed confined single-worker fork profile with 16GiB AS; threads16GiB failed next-worker V8 CodeRange reservation; original repository documents a separate intermittent fork recycle risk'}:null,purpose:pack==='media-presentation'?'Fixed enabled Media presentation regression; supplemental current-source proof':pack==='agents-life-config'?'Fixed configuration ownership diagnosis':pack==='agents-life-diagnostic'?'Fixed two-suite diagnosis; not the 93-suite baseline':'Fixed selected behavioral evidence',fixtureAdaptation,schema:'daylight.landlock.baseline/v1',capturedAt:new Date().toISOString(),target,pack,profile:pack==='gratitude'?'thread-only':'inherited-child',node:process.version,toolRoot,
 command:{executable:'/usr/bin/timeout',args:['--signal=KILL',watchdog,binary,...args]},exitCode:result.status,signal:result.signal,error:result.error?.message,controls,protectedInputsUnchanged,parity,dependencyIdentity,nativePublicESM,nativeUuid,canonicalLibraries,baselineEvidence:baselineFile||null,embedding,compositionControls,healthOwnershipControls,mediaEnrichmentControls,mediaPresentationControls,artAssemblyControls,gamingSupplementalCases,passed,failed,incomplete,vitest,jest,selectedFiles,selectedMoves,inputs,stderr:result.stderr,compileCommand:{executable:'/usr/bin/gcc',args:['-O2','-Wall','-Wextra','-Werror',c,'-o',binary]},manifestSha256:hash(manifest),output,
 limitations:['No filesystem metadata concealment, PID namespace or cgroup quotas',`${pack.startsWith('agents-life-')||['remaining-games','remaining-stockfish','art-canvas'].includes(pack)?16:pack==='gratitude'?2:4} GiB address space, ${['gaming-notation-node','agents-life-concierge','agents-life-diagnostic','agents-life-config'].includes(pack)?1024:pack==='gratitude'?64:256} MiB Node old-space, ${boundedLongProfile&&!['art-canvas','piano-retained-node'].includes(pack)?180:20} CPU seconds, ${boundedLongProfile&&!['art-canvas','piano-retained-node'].includes(pack)?180:45}-second alarm, ${boundedLongProfile?190:50}-second watchdog, ${pack==='remaining-media-tools'?'2 GiB':'4 MiB'} per file, 128 descriptors; no aggregate disk/thread quota`,'Explicit installed node_modules directories permitted read only; this is not candidate parity or deployment validation']};
fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({receipt:path.relative(root,path.join(directory,'receipt.json')),exitCode:result.status,controls,protectedInputsUnchanged,parity,passed:passed.length,failed,incomplete})+'\n');
if((ti86Relay&&passed.length!==5) || (ti86Gui&&target==='candidate'&&(!releaseArtifactParity||nativeTool.binarySha256!==baseline.nativeTool?.binarySha256||JSON.stringify(originalDisabledCases)!==JSON.stringify(baseline.originalDisabledCases))) || (ti86Gui&&(report.releaseCopyControls?.names.length!==7||!report.releaseCopyObservations.some(x=>x.byteCopies>=7&&x.modeVerifications>=7))) || (ti86Native&&((!ti86Gui&&passed.length!==ti86NativeCaseCount)||!report.nativeToolProbe||(ti86Gui&&(originalDisabledCases.length!==1||!report.releaseArtifacts)))) || (pack==='health-stack'&&target==='candidate'&&(healthCliNativeResolution.length!==3||healthCliSupplementalCases.length!==healthCliSupplementalCaseCount)) || (pack==='media-presentation'&&passed.length!==1) || (pack==='retained-ti86'&&(ti86CopyAdaptation.controls?.names.length!==3||!ti86CopyAdaptation.observations.some(item=>item.byteCopies>0&&item.modeVerifications>0))) || (artifactStage&&(!report.artifactStage.originalInputBytesUnchanged||!report.artifactStage.stagedInputBytesUnchanged)) || (pack.startsWith('retained-supplement')&&(retainedCopyControls?.names.length!==10||!retainedCopyAdaptation.observations.some(item=>item.byteCopies>0&&item.modeVerifications>0))) || (pack==='remaining-http'&&proxyControls.length!==3) || (pack==='remaining-http'&&fixtureControls?.names.length!==11) || (pack==='gaming-notation'&&target==='candidate'&&gamingSupplementalCases.length!==17) || (pack==='remaining-http'&&wireControls.length!==4) || (result.status!==0&&!knownFailureCharacterization?.matched) || !controls || !protectedInputsUnchanged || !dependencyIdentity || pack!=='gratitude'&&!nativePublicESM || parity===false || (pack==='m2'&&target==='candidate'&&embedding.length!==1) || (pack==='school-fitness'&&target==='candidate'&&compositionControls.length!==1) || (pack==='health'&&target==='candidate'&&healthOwnershipControls.length!==1) || (pack==='media-content'&&target==='candidate'&&(mediaEnrichmentControls.length!==2||mediaPresentationControls.length!==1)) || (fixtureAdaptation&&!(pack==='gaming-notation-node'?['byteCopies','modeVerifications']:['mtimeSets','overlayStats','byteCopies','modeVerifications']).every(key=>fixtureAdaptation.observations.some(item=>item[key]>0))) || (pack==='piano-retained-node'&&passed.length!==19) || (pack==='art-canvas'&&(passed.length!==(target==='candidate'?6:2)||target==='candidate'&&artAssemblyControls.length!==4)) || (pack==='art-screens'&&passed.length!==15) || (pack==='progress-store'&&passed.length!==24) || (pack==='content-api'&&passed.length!==11) || (pack==='agents-life-http'&&passed.length!==24) || !passed.length || (failed.length&&!knownFailureCharacterization?.matched) || incomplete){process.stdout.write(output+result.stderr);process.exitCode=1;}
