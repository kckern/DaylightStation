/** Checked real bytes/mode for the synthetic journey-doc child, never native copy parity. */
import fs from 'node:fs';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';
import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';
export function installTi86ScratchCopy({scratchRoot}){
 const root=path.resolve(scratchRoot),native=fs.copyFileSync;
 const {copyFileSync,controls}=installHealthScratchFsAdapter({scratchRoot:root,copyOnly:true});
 const group=file=>{if(typeof file!=='string')throw new TypeError('Synthetic journey fixture path required');const relative=path.relative(root,path.resolve(file)).split(path.sep).join('/');if(!/^schoolcalc-journey-doc-[A-Za-z0-9]+\//.test(relative))throw new Error('Unapproved journey copy path');return relative.split('/')[0];};
 fs.copyFileSync=(source,destination,flags=0)=>{if(group(source)!==group(destination))throw new Error('Journey copy crosses fixtures');copyFileSync(source,destination,flags);};syncBuiltinESMExports();
 return {controls,restore(){fs.copyFileSync=native;syncBuiltinESMExports();}};
}
export function assertTi86ScratchCopyControls({scratchRoot}){
 const a=path.join(scratchRoot,'schoolcalc-journey-doc-controls'),b=path.join(scratchRoot,'schoolcalc-journey-doc-other');fs.mkdirSync(a);fs.mkdirSync(b);
 const source=path.join(a,'frame.png'),dest=path.join(a,'copied.png');fs.writeFileSync(source,Buffer.from([137,80,78,71,0,255]));const fixture=installTi86ScratchCopy({scratchRoot});
 const names=[];try{
  fs.copyFileSync(source,dest);if(!fs.readFileSync(dest).equals(fs.readFileSync(source))||fs.statSync(dest).mode!==fs.statSync(source).mode)throw new Error('Real PNG byte/mode parity failed');names.push('actual PNG bytes and mode');
  try{fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL);throw new Error('Exclusive accepted');}catch(e){if(e.code!=='EEXIST')throw e;}names.push('exclusive existing rejected');
  for(const target of [path.join(b,'copy'),path.join(scratchRoot,'outside')]){let rejected=false;try{fs.copyFileSync(source,target);}catch(e){rejected=/crosses|Unapproved/.test(e.message);}if(!rejected)throw new Error('Unsafe path accepted');}names.push('cross-fixture and outside rejected');
  return {names,observations:fixture.controls};
 }finally{fixture.restore();fs.rmSync(a,{recursive:true});fs.rmSync(b,{recursive:true});}
}
