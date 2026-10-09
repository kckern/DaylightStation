import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const adapter = 'modules/art/tests/isolated/adapter/persistence/files/FilesystemCanvasImageRepository.test.mjs';
const api = 'modules/art/tests/isolated/api/routers/canvas.test.mjs';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-isolated-'));
  const put = (p, s="import { it } from 'vitest'; throw Error('DO NOT EVALUATE');") => {
    fs.mkdirSync(path.dirname(path.join(root,p)), {recursive:true}); fs.writeFileSync(path.join(root,p),s);
  };
  for (const name of ['base','isolated']) { const p=`tests/_infrastructure/harnesses/${name}.harness.mjs`; put(p,fs.readFileSync(path.join(sourceRoot,p),'utf8')); }
  put(adapter); put(api);
  const run = (...args) => {
    const stdout=execFileSync(process.execPath,[path.join(root,'tests/_infrastructure/harnesses/isolated.harness.mjs'),'--dry-run',...args],{encoding:'utf8'});
    return {stdout,files:stdout.split('\n').filter(s=>s.startsWith('  '+root+path.sep)).map(s=>path.relative(root,s.trim())).sort()};
  };
  return {root,put,run,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('default discovers both original moved Art oracles exactly once and routes their Vitest imports',()=>{
  const f=fixture();try{f.put('tests/isolated/system/Legacy.test.mjs');const result=f.run();assert.deepEqual(result.files,[adapter,api,'tests/isolated/system/Legacy.test.mjs'].sort());assert.match(result.stdout,/Re-routed 2 file/);assert.match(result.stdout,/vitest ← modules\/art\/tests\/isolated\/adapter/);}finally{f.close();}
});
test('owner isolated target and pattern filtering preserve existing options',()=>{
  const f=fixture();try{assert.deepEqual(f.run('--only=adapter').files,[adapter]);assert.deepEqual(f.run('--only=api').files,[api]);assert.deepEqual(f.run('--only=adapter','--pattern=canvas').files,[]);assert.deepEqual(f.run('--pattern=canvas').files,[api]);assert.deepEqual(f.run('--skip=api').files,[adapter]);}finally{f.close();}
});
test('frontend-only excludes owner isolated suites; absent roots and unlisted targets stay legal',()=>{
  const f=fixture();try{f.put('frontend/src/Frontend.test.jsx');f.put('modules/art/tests/isolated/unlisted/Hidden.test.mjs');assert.deepEqual(f.run('--only=frontend').files,['frontend/src/Frontend.test.jsx']);assert.deepEqual(f.run('--only=system').files,[]);fs.rmSync(path.join(f.root,'modules'),{recursive:true});assert.deepEqual(f.run().files,['frontend/src/Frontend.test.jsx']);}finally{f.close();}
});
