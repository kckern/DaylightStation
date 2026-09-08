/** Standalone preparation config: no inherited root setup or dev server. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
if(!process.env.PRE_RUN_ROOT)throw new Error('Isolated root required');
const population=JSON.parse(fs.readFileSync(path.join(root,'docs/_wip/audits/2026-09-05-application-module-preimplementation/test-population.json')));
const selected={
  'stored-shape':['tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs'],
  'print-gateway':['backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.test.mjs']
};
const include=process.env.PRE_VITEST_MODE==='discover'?population.files.map(f=>f.path):selected[process.env.PRE_VITEST_MODE];
if(!include)throw new Error('Explicit allowlisted preparation Vitest mode required');
export default {
  root,cacheDir:path.join(process.env.PRE_RUN_ROOT,'vite-cache'),
  resolve:{alias:Object.fromEntries([['#adapters','1_adapters'],['#apps','3_applications'],['#system','0_system'],['#domains','2_domains']].map(([alias,layer])=>[alias,path.join(root,'backend/src',layer)]))},
  server:{watch:null,middlewareMode:true,hmr:false},
  test:{include,exclude:['**/node_modules/**'],environment:'node',setupFiles:[],globals:false,watch:false,cache:false,pool:'threads',maxWorkers:1,fileParallelism:false,passWithNoTests:false}
};
