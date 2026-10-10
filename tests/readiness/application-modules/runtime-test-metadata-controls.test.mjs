import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { metadataRelative, validateTestMetadata, dependencyReadGrants, assertMetadataDenied, skipTestMetadata } from './runtime-test-metadata.mjs';
import { treeInventory } from './run-isolated-pair.mjs';
const installed=process.env.READINESS_METADATA_TOOL_ROOT ?? path.resolve(fs.realpathSync(path.resolve(import.meta.dirname,'../../..','node_modules/vitest')),'../..');
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'readiness-metadata-control-'));fs.chmodSync(root,0o700);
  const file=path.join(root,metadataRelative),producer=path.join(root,'node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(path.dirname(producer),{recursive:true});
  fs.copyFileSync(path.join(installed,'node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js'),producer);
  const write=value=>fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
  const value={version:'4.1.10',results:[['synthetic.test.mjs',{duration:3,failed:false}]]};write(value);
  const sibling=path.join(path.dirname(file),'executable.mjs');fs.writeFileSync(sibling,'export default 1;');
  const deps=path.join(root,'node_modules/.vite/deps');fs.mkdirSync(deps);fs.writeFileSync(path.join(deps,'dep.js'),'export default 1;');
  return {root,file,write,value,sibling,deps,producer,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const readable=(rows,file)=>rows.some(([grant,kind])=>(kind==='F'&&file===grant)||(kind==='D'&&(file===grant||file.startsWith(grant+path.sep))));
test('only exact validated scheduling metadata is omitted; sibling bytes and directory names stay inventoried',()=>{
 const f=fixture();try {
  const m=validateTestMetadata(f.root),root=path.join(f.root,'node_modules');
  const before=treeInventory([root],m);assert.ok(!before.some(r=>r.file===f.file));assert.ok(before.some(r=>r.file===f.sibling&&r.sha256));
  f.value.results[0][1].duration=99;f.write(f.value);assert.deepEqual(treeInventory([root],validateTestMetadata(f.root)),before);
  fs.writeFileSync(f.sibling,'export default 2;');assert.notDeepEqual(treeInventory([root],m),before);
  const changed=treeInventory([root],m);fs.writeFileSync(path.join(f.deps,'dep.js'),'export default 2;');assert.notDeepEqual(treeInventory([root],m),changed);
  const bytes=treeInventory([root],m);fs.writeFileSync(path.join(path.dirname(f.file),'new.json'),'{}');assert.notDeepEqual(treeInventory([root],m),bytes);
 }finally{f.cleanup();}
});
test('narrowed grants deny exact metadata while preserving sibling and unrelated root permissions',()=>{
 const f=fixture();try {
  const m=validateTestMetadata(f.root),rows=dependencyReadGrants(path.join(f.root,'node_modules'),m);
  assert.equal(readable(rows,f.file),false);assert.equal(readable(rows,f.sibling),true);assert.equal(readable(rows,path.join(f.deps,'dep.js')),true);assert.equal(readable(rows,f.producer),true);
  const other=path.join(f.root,'backend/node_modules');fs.mkdirSync(other,{recursive:true});assert.deepEqual(dependencyReadGrants(other,m),[[other,'D']]);
  assert.throws(()=>assertMetadataDenied([[path.join(f.root,'node_modules'),'D']],m));assert.throws(()=>assertMetadataDenied([[f.file,'F']],m));
  assert.equal(skipTestMetadata(f.file,f.file,m),true);assert.equal(skipTestMetadata(f.sibling,f.sibling,m),false);assert.throws(()=>skipTestMetadata(f.sibling,f.file,m));
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret'),'synthetic');fs.symlinkSync(outside,path.join(f.root,'node_modules/outside'));
  assert.equal(readable(dependencyReadGrants(path.join(f.root,'node_modules'),m),path.join(outside,'secret')),false);
  fs.symlinkSync(path.join(f.root,'node_modules'),path.join(f.root,'node_modules/self'));
  const aliasRows=dependencyReadGrants(path.join(f.root,'node_modules'),m);assertMetadataDenied(aliasRows,m);assert.equal(readable(aliasRows,f.file),false);
  fs.symlinkSync(f.file,path.join(f.root,'node_modules/metadata-alias'));
  assert.throws(()=>dependencyReadGrants(path.join(f.root,'node_modules'),m));assert.throws(()=>treeInventory([path.join(f.root,'node_modules')],m));
 }finally{f.cleanup();}
});
for(const [name,change] of [
 ['extra field',f=>f.write({...f.value,payload:'x'})],['wrong version',f=>f.write({...f.value,version:'4.1.9'})],
 ['wrong rows',f=>f.write({...f.value,results:[['x',{duration:-1,failed:false}]]})],['wrong boolean',f=>f.write({...f.value,results:[['x',{duration:1,failed:0}]]})],
 ['row extra field',f=>f.write({...f.value,results:[['x',{duration:1,failed:false,code:'x'}]]})],
 ['malformed JSON',f=>fs.writeFileSync(f.file,'{')],['hardlink',f=>fs.linkSync(f.file,f.file+'.alias')],
 ['symlink',f=>{fs.renameSync(f.file,f.file+'.real');fs.symlinkSync(f.file+'.real',f.file);}],
 ['directory',f=>{fs.unlinkSync(f.file);fs.mkdirSync(f.file);}],
 ['cache sibling layout',f=>fs.mkdirSync(path.join(path.dirname(path.dirname(f.file)),'other-hash'))],
 ['producer drift',f=>fs.appendFileSync(f.producer,'\n// changed')]
]) test('rejects '+name,()=>{const f=fixture();try{change(f);assert.throws(()=>validateTestMetadata(f.root));}finally{f.cleanup();}});
test('actual installed metadata and narrowed grant preflight',()=>{
 const m=validateTestMetadata(installed),rows=['','backend','frontend'].flatMap(scope=>dependencyReadGrants(fs.realpathSync(path.join(installed,scope,'node_modules')),m));assertMetadataDenied(rows,m);
 assert.equal(readable(rows,m.file),false);assert.equal(readable(rows,path.join(installed,'frontend/node_modules/.vite/deps')),true);
});
