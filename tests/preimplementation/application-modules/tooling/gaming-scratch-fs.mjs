/** Test-only actual byte/mode copy in one synthetic gaming fixture; not native copy parity. */
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';
export function installGamingScratchFsAdapter({scratchRoot}) {
  const root=path.resolve(scratchRoot),nativeCopy=fs.promises.copyFile;
  const {copyFileSync,controls}=installHealthScratchFsAdapter({scratchRoot:root,copyOnly:true});
  function subtree(input){
    if(typeof input!=='string')throw new TypeError('Fixture path must be a string');
    const relative=path.relative(root,path.resolve(input));
    if(!/^gaming-assets-[a-zA-Z0-9]+\//.test(relative.split(path.sep).join('/')))throw new Error('Unapproved gaming fixture path');
    return relative.split(path.sep)[0];
  }
  fs.promises.copyFile=async(source,destination,flags=0)=>{
    if(subtree(source)!==subtree(destination))throw new Error('Gaming fixture copy crosses fixture roots');
    copyFileSync(source,destination,flags);
  };
  syncBuiltinESMExports();
  return {controls,restore(){fs.promises.copyFile=nativeCopy;syncBuiltinESMExports();}};
}
