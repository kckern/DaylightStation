/** Actual bytes/mode for precisely selected synthetic retained CLI copies. */
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';
export function installRetainedScratchFsAdapter(options){
 const nativeCopy=fs.promises.copyFile,nativeChmod=fs.promises.chmod;
 const {copyFileSync,controls}=installHealthScratchFsAdapter({...options,copyOnly:true,fixtureFamily:'retained'});
 fs.promises.copyFile=async(source,destination,flags=0)=>copyFileSync(source,destination,flags);
 fs.promises.chmod=async(file,mode)=>{
  const root=path.resolve(options.scratchRoot),resolved=path.resolve(file),relative=path.relative(root,resolved);
  if(!/^(charades-history-cli|exercise-library-clean|producer-v2)-[A-Za-z0-9]+\//.test(relative.split(path.sep).join('/')))throw new Error('Unapproved retained mode verification path');
  if(fs.realpathSync(resolved)!==resolved||fs.lstatSync(resolved).isSymbolicLink())throw new Error('Mode verification requires canonical non-symlink path');
  const stat=fs.statSync(resolved);if(!stat.isFile()&&!stat.isDirectory())throw new Error('Mode verification requires regular file or directory');
  if((stat.mode&0o7777)!==(mode&0o7777))throw new Error('Retained fixture mode mismatch; metadata mutation forbidden');
  controls.modeVerifications++;
 };
 syncBuiltinESMExports();
 return {controls,restore(){fs.promises.copyFile=nativeCopy;fs.promises.chmod=nativeChmod;syncBuiltinESMExports();}};
}
