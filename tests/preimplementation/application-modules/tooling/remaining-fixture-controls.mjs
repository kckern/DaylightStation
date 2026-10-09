/** Meaningful controls over named private fixtures, never native metadata parity. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {installHealthScratchFsAdapter} from './health-scratch-fs.mjs';
export function assertRemainingFixtureControls({scratchRoot,readOnlyFixtures=[]}) {
  const native={...fs},root=path.resolve(scratchRoot),names=[];
  const group=path.join(root,'chess-backfill-controls'),other=path.join(root,'chess-backfill-other');
  const mtimeDir=path.join(root,'livestream-tts-test-123');
  for(const dir of [group,other,mtimeDir])fs.mkdirSync(dir,{recursive:true});
  const source=path.join(group,'source.bin'),dest=path.join(group,'copy.bin');
  const timeFile=path.join(mtimeDir,'abcdef.mp3'),unapproved=path.join(group,'unapproved.bin');
  const bytes=Buffer.from([0,255,128,13,10]);
  fs.writeFileSync(source,bytes,{mode:0o600});fs.writeFileSync(timeFile,'synthetic',{mode:0o600});fs.writeFileSync(unapproved,'synthetic');
  const before=native.statSync(timeFile).mtimeMs;
  const school=path.join(root,'school-lifecycle-e2e-controls'),readOnlyDir=path.join(root,'readonly-control');native.mkdirSync(school);native.mkdirSync(readOnlyDir);const listed=path.join(readOnlyDir,'listed.yml'),unlisted=path.join(readOnlyDir,'unlisted.yml');native.writeFileSync(listed,'school',{mode:0o600});native.writeFileSync(unlisted,'unlisted');
  const fixture=installHealthScratchFsAdapter({scratchRoot:root,fixtureFamily:'remaining',readOnlyFixtures:[...readOnlyFixtures,listed]});
  const check=(name,fn)=>{fn();names.push(name);process.stdout.write('FIXTURE CONTROL '+name+': PASS\n');};
  try{
    check('inode-bound mtime overlay preserves native metadata',()=>{fs.utimesSync(timeFile,1,1);assert.equal(fs.statSync(timeFile).mtimeMs,1000);assert.equal(native.statSync(timeFile).mtimeMs,before);});
    check('unapproved mtime rejected',()=>assert.throws(()=>fs.utimesSync(unapproved,1,1),/Unapproved/));
    check('actual binary bytes and mode copied',()=>{fs.copyFileSync(source,dest);assert.deepEqual(native.readFileSync(dest),bytes);assert.equal(native.statSync(dest).mode&0o777,0o600);});
    check('exclusive copy and original source preserved',()=>{assert.throws(()=>fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL),{code:'EEXIST'});assert.deepEqual(native.readFileSync(source),bytes);});
    check('outside and cross-fixture copies rejected',()=>{assert.throws(()=>fs.copyFileSync('/etc/hostname',dest),/escapes/);assert.throws(()=>fs.copyFileSync(source,path.join(other,'copy.bin')),/Cross-fixture/);});
    check('symlink copy rejected',()=>{const link=path.join(group,'link');fs.symlinkSync(source,link);assert.throws(()=>fs.copyFileSync(link,dest),/symlink/);});
    check('inode replacement rejected',()=>{const replacement=path.join(mtimeDir,'replacement');native.writeFileSync(replacement,'new');native.renameSync(replacement,timeFile);assert.throws(()=>fs.statSync(timeFile),/identity changed/);});
    check('listed source copies only into School fixture',()=>{fs.copyFileSync(listed,path.join(school,'listed.yml'));assert.equal(native.readFileSync(path.join(school,'listed.yml'),'utf8'),'school');assert.throws(()=>fs.copyFileSync(listed,path.join(group,'listed.yml')),/School scratch/);});
    check('unlisted read-only source rejected',()=>assert.throws(()=>fs.copyFileSync(unlisted,path.join(school,'unlisted.yml')),/Cross-fixture/));
    check('read-only source inode replacement rejected',()=>{const next=path.join(readOnlyDir,'next');native.writeFileSync(next,'replacement');native.renameSync(next,listed);assert.throws(()=>fs.copyFileSync(listed,path.join(school,'replacement.yml')),/identity changed/);});
    check('metadata repair methods unchanged',()=>{assert.equal(fs.chmodSync,native.chmodSync);assert.equal(fs.chownSync,native.chownSync);});
  }finally{fixture.restore();for(const dir of [group,other,mtimeDir,school,readOnlyDir])native.rmSync(dir,{recursive:true,force:true});}
  return {names,observations:fixture.controls};
}
