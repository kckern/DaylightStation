import {mainCurrentSelected} from './main-current-selected.mjs';
import {mainPianoRepSelected} from './main-piano-rep-selected.mjs';
import {mainGhostSelected} from './main-ghost-selected.mjs';
import {mainChessSelected} from './main-chess-selected.mjs';
import {mainSchoolSelected} from './main-school-selected.mjs';
import {ti86NativeSelected,ti86GuiSelected,ti86RelaySelected} from './ti86-native-selected.mjs';
import {retainedVitest,retainedNode,retainedTi86Vitest,retainedTi86Unrun} from './retained-supplement-selected.mjs';
import {remainingVitestSelections,remainingHttpSupported} from './remaining-selected.mjs';
import {agentsLifeConciergeVitest,agentsLifeHttpVitest} from './agents-life-concierge-selected.mjs';
import {contentApiVitest} from './content-api-selected.mjs';
import {gamingNotationVitest,gamingSupplemental} from './gaming-notation-selected.mjs';
/** Standalone preparation config: no inherited root setup or dev server. */
import fs from 'node:fs';
import {botsDisplaysVitest} from './bots-displays-selected.mjs';
import {mediaContentVitest} from './media-content-selected.mjs';
import {m2Selected} from './m2-selected.mjs';
import {healthStackSelected,healthCliSupplemental,healthCliSupplementalCaseCount} from './health-stack-selected.mjs';
import {healthSelected} from './health-selected.mjs';
import {schoolFitnessSelected} from './school-fitness-selected.mjs';
const dom= ['main-ghost','main-chess','main-piano-rep','main-current','main-school','media-presentation','retained-supplement','art-screens','progress-store','remaining-stockfish','remaining-http'].includes(process.env.PRE_VITEST_MODE)||Object.hasOwn(remainingVitestSelections,process.env.PRE_VITEST_MODE)||['remaining-stockfish','remaining-http','agents-life-config','agents-life-diagnostic','agents-life-concierge','agents-life-http','integration','m2','health-stack','school-fitness','bots-displays','media-content','gaming-notation','content-api'].includes(process.env.PRE_VITEST_MODE);
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
if(!process.env.PRE_RUN_ROOT)throw new Error('Isolated root required');
const selected={'main-ghost':mainGhostSelected,'main-chess':mainChessSelected,'main-piano-rep':mainPianoRepSelected,'main-current':mainCurrentSelected,'main-school':mainSchoolSelected,'retained-ti86-relay':ti86RelaySelected,'retained-ti86-gui':ti86GuiSelected,'retained-ti86-native':ti86NativeSelected,'media-presentation':['modules/media/browser/content-filter/videoPresentation.test.jsx'],'retained-ti86':retainedTi86Vitest,'retained-supplement':retainedVitest,'art-canvas':['tests/isolated/adapter/persistence/files/FilesystemCanvasImageRepository.test.mjs'],'art-screens':["tests/unit/art/screensList.test.mjs", "tests/unit/art/screensPreset.test.mjs", "tests/isolated/adapter/persistence/files/FilesystemScreensRepository.test.mjs"],'progress-store':["backend/src/1_adapters/persistence/yaml/YamlUserVideoProgressStore.test.mjs", "tests/isolated/application/school/materialProgressStore.test.mjs", "modules/piano/server/api/piano.economyHook.test.mjs"],'remaining-stockfish':['backend/src/1_adapters/chess/StockfishEngineAdapter.test.mjs'],'agents-life-config':['tests/isolated/agents/framework/loadAgentConfig.test.mjs'],...remainingVitestSelections,'remaining-http':remainingHttpSupported,'agents-life-diagnostic':['tests/isolated/adapters/agents/MastraAdapter.modern.test.mjs','backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs'],'agents-life-concierge':agentsLifeConciergeVitest,'agents-life-http':agentsLifeHttpVitest,'content-api':contentApiVitest,'gaming-notation':gamingNotationVitest,'bots-displays':botsDisplaysVitest,'media-content':mediaContentVitest,m2:m2Selected,'health-stack':healthStackSelected,health:healthSelected,'school-fitness':schoolFitnessSelected,
  'stored-shape':['tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs'],
  'integration':[
 'tests/unit/domains/gratitude/PrintSelectionService.test.mjs',
 'modules/gratitude/server/application/services/GratitudeCardPrintService.test.mjs',
 'modules/gratitude/server/application/services/GratitudePrintPresentationService.test.mjs',
 'modules/gratitude/server/api/gratitude.card.test.mjs',
 'modules/gratitude/server/adapters/printing/TemporaryImagePrintGateway.test.mjs',
 'tests/isolated/flow/homebot/ProcessGratitudeInput.test.mjs',
 'tests/isolated/flow/homebot/AssignItemToUser.test.mjs',
 'tests/isolated/flow/homebot/HomeBotEventRouter.test.mjs',
 'tests/isolated/adapter/feed/AdapterProvides.test.mjs',
 'capabilities/household-identity/browser/FamilySelector.test.jsx'],
 'print-gateway':['modules/gratitude/server/adapters/printing/TemporaryImagePrintGateway.test.mjs']
};
let include=process.env.PRE_VITEST_MODE==='discover'?JSON.parse(fs.readFileSync(path.join(root,'docs/_wip/audits/2026-09-05-application-module-preimplementation/test-population.json'))).files.map(f=>f.path):selected[process.env.PRE_VITEST_MODE];
if(!include)throw new Error('Explicit allowlisted preparation Vitest mode required');
if(process.env.PRE_TARGET==='candidate'&&(Object.hasOwn(remainingVitestSelections,process.env.PRE_VITEST_MODE)||['main-ghost','main-chess','main-piano-rep','main-current','main-school','retained-ti86-relay','retained-ti86-gui','retained-ti86-native','retained-ti86','retained-supplement','art-canvas','progress-store','art-screens','remaining-http','agents-life-diagnostic','agents-life-concierge','agents-life-http','bots-displays','media-content','gaming-notation','content-api'].includes(process.env.PRE_VITEST_MODE))){
 if(!process.env.PRE_SELECTED_MOVES)throw new Error('Reviewed candidate move map required');
 const moves=JSON.parse(fs.readFileSync(process.env.PRE_SELECTED_MOVES));
 include=include.map(file=>Object.hasOwn(moves,file)?moves[file]:file);
 if(include.some(file=>typeof file!=='string'||path.isAbsolute(file)||file.split(/[\\/]/).includes('..')))throw new Error('Unsafe candidate oracle path');
}
if(process.env.PRE_TARGET==='candidate'&&process.env.PRE_VITEST_MODE==='health-stack')include=[...include,...healthCliSupplemental];
if(process.env.PRE_TARGET==='candidate'&&process.env.PRE_VITEST_MODE==='art-canvas')include=[...include,'modules/art/tests/composition/installed-runtime.test.mjs'];
if(['retained-ti86','retained-ti86-native','retained-ti86-gui','retained-ti86-relay'].includes(process.env.PRE_VITEST_MODE))include=include.map(file=>path.join(process.env.PRE_RUN_ROOT,'artifact-source',file));
if(process.env.PRE_TARGET==='candidate'&&process.env.PRE_VITEST_MODE==='gaming-notation')include=[...include,...gamingSupplemental];
if(process.env.PRE_TARGET==='candidate'&&process.env.PRE_VITEST_MODE==='media-content')include=[...include,'capabilities/content-catalog/server/adapters/providers/plex/PlexAdapter.curriculumEnrichment.test.mjs','backend/src/5_composition/integrations/providerOwnership.test.mjs','modules/media/browser/content-filter/videoPresentation.test.jsx'];
const aliasRoot=['retained-ti86-native','retained-ti86-gui','retained-ti86-relay'].includes(process.env.PRE_VITEST_MODE)?path.join(process.env.PRE_RUN_ROOT,'artifact-source'):root;
export default {
  plugins:dom?[{name:'selected-dom-style-resolution',enforce:'pre',resolveId(id){if(id.endsWith('.scss'))return path.join(process.env.PRE_RUN_ROOT,'styles.css');}}]:[],
  root,esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(process.env.PRE_RUN_ROOT,'vite-cache'),
  resolve:{dedupe:['react','react-dom'],alias:{...(process.env.PRE_VITEST_MODE==='main-chess'?{supertest:path.join(root,'tests/preimplementation/application-modules/drivers/remaining-http-request.mjs')}:{}),'@':path.join(aliasRoot,'frontend/src'),'react':path.join(process.env.PRE_TOOLCHAIN_ROOT,'frontend/node_modules/react'),'@shared-contracts':path.join(aliasRoot,'shared/contracts'),'@shared-presentation':path.join(aliasRoot,'shared/presentation/scenes'),'@shared-gaming':path.join(aliasRoot,'shared/gaming'),'@shared-music':path.join(aliasRoot,'shared/music'),'@shared-interaction':path.join(aliasRoot,'shared/interaction'),'react-dom':path.join(process.env.PRE_TOOLCHAIN_ROOT,'frontend/node_modules/react-dom'),'@testing-library':path.join(process.env.PRE_TOOLCHAIN_ROOT,'frontend/node_modules/@testing-library'),...Object.fromEntries([['#adapters','1_adapters'],['#apps','3_applications'],['#system','0_system'],['#domains','2_domains'],['#api','4_api']].map(([alias,layer])=>[alias,path.join(aliasRoot,'backend/src',layer)])),'#backend':path.join(aliasRoot,'backend')}},
  server:{host:"127.0.0.1",watch:null,middlewareMode:true,hmr:false},
  test:{include,exclude:['**/node_modules/**'],environment:dom&&process.env.PRE_VITEST_MODE!=='integration'?path.join(root,'tests/_infrastructure/frontend-env.mjs'):'node',setupFiles:dom?[path.join(process.env.PRE_RUN_ROOT,'vitest-setup.mjs')]:[],globals:dom,watch:false,cache:false,pool:(process.env.PRE_VITEST_MODE==='art-canvas'||['retained-ti86','retained-ti86-native','retained-ti86-gui','retained-ti86-relay'].includes(process.env.PRE_VITEST_MODE)||process.env.PRE_VITEST_MODE.startsWith('agents-life-'))?'forks':dom||process.env.PRE_VITEST_MODE==='health'?'forks':'threads',maxWorkers:1,fileParallelism:false,passWithNoTests:false}
};
