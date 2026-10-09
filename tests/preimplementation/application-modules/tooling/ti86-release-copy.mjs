/** Confined release-fixture bytes/mode adapter; never a native-copy or metadata claim. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';
const names=new Set(['SCHLCALC.86p','SCLEARN.86p','SCQUEUE.86p','SCQR.86p','SCSYNC.86p','DSID.86s','ASCHL.86p']);
export function installTi86ReleaseCopy({scratchRoot,artifactRoot}) {
 const root=fs.realpathSync(scratchRoot),artifact=fs.realpathSync(artifactRoot);
 assert.ok(artifact.startsWith(root+path.sep),'Artifact must be inside private scratch');
 const original=fs.copyFileSync,{copyFileSync,controls}=installHealthScratchFsAdapter({scratchRoot:root,copyOnly:true});
 fs.copyFileSync=(source,destination,flags=0)=>{
  if(typeof source!=='string'||typeof destination!=='string')throw new TypeError('Release fixture paths required');
  const src=path.relative(artifact,path.resolve(source)).split(path.sep).join('/');
  const dst=path.relative(artifact,path.resolve(destination)).split(path.sep).join('/');
  const match=/^dist\/install-ti86a-[a-f0-9]{12}\/([^/]+)$/.exec(dst);
  const name=src.startsWith('dist/')?src.slice(5):'';
  if(!names.has(name)||!match||match[1]!==name)throw new Error('Unapproved release fixture copy');
  copyFileSync(source,destination,flags);
 };
 syncBuiltinESMExports();
 return {controls,restore(){fs.copyFileSync=original;syncBuiltinESMExports();}};
}
export function assertTi86ReleaseCopyControls({scratchRoot}) {
 const artifact=path.join(scratchRoot,'release-copy-controls'),dist=path.join(artifact,'dist'),bundle=path.join(dist,'install-ti86a-012345abcdef');
 fs.mkdirSync(bundle,{recursive:true});
 const source=path.join(dist,'SCHLCALC.86p'),dest=path.join(bundle,'SCHLCALC.86p'),bytes=Buffer.from([0,255,205,52,18]);
 fs.writeFileSync(source,bytes,{mode:0o644});
 const native={statSync:fs.statSync,utimesSync:fs.utimesSync};
 const fixture=installTi86ReleaseCopy({scratchRoot,artifactRoot:artifact}),names=[];
 try {
  fs.copyFileSync(source,dest);assert.deepEqual(fs.readFileSync(dest),bytes);assert.equal(fs.statSync(dest).mode,fs.statSync(source).mode);assert.deepEqual(fs.readFileSync(source),bytes);names.push('real binary bytes, source intact, mode');
  assert.throws(()=>fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL),e=>e.code==='EEXIST');names.push('exclusive existing destination');
  for(const target of [path.join(bundle,'DSID.86s'),path.join(dist,'copied.86p'),path.join(scratchRoot,'outside.86p')])assert.throws(()=>fs.copyFileSync(source,target),/Unapproved/);assert.throws(()=>fs.copyFileSync(path.join(scratchRoot,'other-source'),dest),/Unapproved/);names.push('wrong name, layout, outside, source');
  fs.unlinkSync(dest);fs.symlinkSync(source,dest);assert.throws(()=>fs.copyFileSync(source,dest),/symlink|regular|canonical/i);fs.unlinkSync(dest);names.push('destination symlink rejected');
  fs.writeFileSync(dest,bytes,{mode:0o600});assert.throws(()=>fs.copyFileSync(source,dest),/mode/);names.push('mode mismatch rejected');
  assert.throws(()=>fs.copyFileSync(source,dest,fs.constants.COPYFILE_FICLONE),/ordinary or exclusive/);names.push('clone flags rejected');
  assert.equal(fs.statSync,native.statSync);assert.equal(fs.utimesSync,native.utimesSync);names.push('native metadata functions unchanged');
  return {names,observations:fixture.controls};
 } finally {fixture.restore();fs.rmSync(artifact,{recursive:true});}
}
