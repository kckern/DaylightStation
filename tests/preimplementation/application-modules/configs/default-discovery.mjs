/** Existing Vitest discovery policy; only runtime safety/output settings overridden. */
import path from 'node:path';
import original from '../../../../vitest.config.mjs';
if(!process.env.PRE_RUN_ROOT)throw new Error('Isolated root required');
export default {...original,cacheDir:path.join(process.env.PRE_RUN_ROOT,'vite-cache'),server:{watch:null,middlewareMode:true,hmr:false},test:{...original.test,watch:false,cache:false}};
