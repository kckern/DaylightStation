import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {installRetainedScratchFsAdapter} from './retained-scratch-fs.mjs';
export async function assertRetainedCopyControls({scratchRoot}){
 const root=path.join(scratchRoot,'retained-copy-controls');fs.mkdirSync(root);
 const g=path.join(root,'producer-v2-fixture'),other=path.join(root,'producer-v2-other'),exercise=path.join(root,'exercise-library-clean-fixture'),readonly=path.join(root,'listed.yml'),unlisted=path.join(root,'unlisted.yml');
 for(const d of [g,other,exercise])fs.mkdirSync(d);fs.writeFileSync(readonly,'listed fixture');fs.writeFileSync(unlisted,'unlisted');
 const source=path.join(g,'source');fs.writeFileSync(source,Buffer.from([0,1,255,71]));const before=fs.statSync(source).mode;
 const fixture=installRetainedScratchFsAdapter({scratchRoot:root,readOnlyFixtures:[readonly]});const names=[];
 try{
  const dest=path.join(g,'copy');await fs.promises.copyFile(source,dest);assert(fs.readFileSync(dest).equals(fs.readFileSync(source)));assert.equal(fs.statSync(dest).mode,before);names.push('actual binary bytes and mode');
  await assert.rejects(fs.promises.copyFile(source,dest,fs.constants.COPYFILE_EXCL),e=>e.code==='EEXIST');names.push('exclusive existing destination');
  await assert.rejects(fs.promises.copyFile(source,path.join(other,'copy')),/Cross-fixture/);names.push('cross-fixture rejected');
  await fs.promises.copyFile(readonly,path.join(exercise,'listed'));assert.equal(fs.readFileSync(path.join(exercise,'listed'),'utf8'),'listed fixture');names.push('exact readonly corpus copied');
  await assert.rejects(fs.promises.copyFile(unlisted,path.join(exercise,'unlisted')),/Cross-fixture/);names.push('unlisted readonly rejected');
  fs.renameSync(readonly,readonly+'.old');fs.writeFileSync(readonly,'replacement');await assert.rejects(fs.promises.copyFile(readonly,path.join(exercise,'replaced')),/identity changed/);names.push('readonly inode replacement rejected');
  await assert.rejects(fs.promises.copyFile(source,path.join(scratchRoot,'outside')),/escapes private scratch/);names.push('outside root rejected');
  fs.symlinkSync(source,path.join(g,'link'));await assert.rejects(fs.promises.copyFile(path.join(g,'link'),path.join(g,'linked')),/symlink/);names.push('symlink rejected');
  await assert.rejects(fs.promises.chmod(source,(before&0o7777)^0o100),/mode mismatch/);assert.equal(fs.statSync(source).mode,before);names.push('mode changes rejected without mutation');
  await assert.rejects(fs.promises.chmod(readonly,0o644),/Unapproved/);names.push('outside-group chmod rejected');
  return {names,observations:fixture.controls};
 }finally{fixture.restore();fs.rmSync(root,{recursive:true});}
}
