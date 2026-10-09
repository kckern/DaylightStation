/** Standalone preparation config: no inherited root setup or dev server. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
if(!process.env.PRE_RUN_ROOT)throw new Error('Isolated root required');
const selected={
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
const include=process.env.PRE_VITEST_MODE==='discover'?JSON.parse(fs.readFileSync(path.join(root,'docs/_wip/audits/2026-09-05-application-module-preimplementation/test-population.json'))).files.map(f=>f.path):selected[process.env.PRE_VITEST_MODE];
if(!include)throw new Error('Explicit allowlisted preparation Vitest mode required');
export default {
  plugins:process.env.PRE_VITEST_MODE==='integration'?[{name:'selected-dom-style-resolution',enforce:'pre',resolveId(id){if(id.endsWith('.scss'))return path.join(process.env.PRE_RUN_ROOT,'styles.css');}}]:[],
  root,esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(process.env.PRE_RUN_ROOT,'vite-cache'),
  resolve:{dedupe:['react','react-dom'],alias:{'@':path.join(root,'frontend/src'),'react':path.join(process.env.PRE_TOOLCHAIN_ROOT,'frontend/node_modules/react'),'react-dom':path.join(process.env.PRE_TOOLCHAIN_ROOT,'frontend/node_modules/react-dom'),'@testing-library':path.join(process.env.PRE_TOOLCHAIN_ROOT,'frontend/node_modules/@testing-library'),...Object.fromEntries([['#adapters','1_adapters'],['#apps','3_applications'],['#system','0_system'],['#domains','2_domains'],['#api','4_api']].map(([alias,layer])=>[alias,path.join(root,'backend/src',layer)])),'#backend':path.join(root,'backend')}},
  server:{host:"127.0.0.1",watch:null,middlewareMode:true,hmr:false},
  test:{include,exclude:['**/node_modules/**'],environment:'node',setupFiles:process.env.PRE_VITEST_MODE==='integration'?[path.join(process.env.PRE_RUN_ROOT,'vitest-setup.mjs')]:[],globals:process.env.PRE_VITEST_MODE==='integration',watch:false,cache:false,pool:process.env.PRE_VITEST_MODE==='integration'?'forks':'threads',maxWorkers:1,fileParallelism:false,passWithNoTests:false}
};
