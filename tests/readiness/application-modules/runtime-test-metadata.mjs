// One installed Vitest scheduling cache is outside API inputs and unreadable in API children.
// Executable dependencies and every sibling cache entry remain guarded and readable as before.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const metadataRelative = 'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json';
const producerRelative = 'node_modules/vitest/dist/chunks/cli-api.BK8pd4xc.js';
const producerSha256 = 'a2d629ec07fbaf58055bca9858076c6c13763042d97196272c45ccfdb727f498';
export function validateTestMetadata(toolRoot) {
  assert.equal(fs.realpathSync(toolRoot),toolRoot,'Canonical tool root');
  const file=path.join(toolRoot,metadataRelative);
  for(let current=file;current!==toolRoot;current=path.dirname(current)) {
    const stat=fs.lstatSync(current);
    assert.equal(fs.realpathSync(current),current,'Metadata ancestry must be canonical');
    assert.ok(!stat.isSymbolicLink()&&(current===file?stat.isFile():stat.isDirectory()),'Regular metadata ancestry');
  }
  assert.equal(fs.lstatSync(file).nlink,1,'No metadata hardlink aliases');
  const vitest=path.dirname(path.dirname(file));
  assert.deepEqual(fs.readdirSync(vitest).sort(),['da39a3ee5e6b4b0d3255bfef95601890afd80709'],'Reviewed Vitest cache layout');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.deepEqual(Object.keys(value).sort(),['results','version']);
  assert.equal(value.version,'4.1.10');assert.ok(Array.isArray(value.results));
  for(const row of value.results) {
    assert.ok(Array.isArray(row)&&row.length===2&&typeof row[0]==='string');
    assert.ok(row[1]&&typeof row[1]==='object'&&!Array.isArray(row[1]));
    assert.deepEqual(Object.keys(row[1]).sort(),['duration','failed']);
    assert.ok(Number.isFinite(row[1].duration)&&row[1].duration>=0&&typeof row[1].failed==='boolean');
  }
  const producer=path.join(toolRoot,producerRelative);
  assert.equal(fs.realpathSync(producer),producer);assert.ok(fs.lstatSync(producer).isFile());
  assert.equal(createHash('sha256').update(fs.readFileSync(producer)).digest('hex'),producerSha256,'Reviewed installed cache producer');
  return {file,producer,producerSha256,policy:'API-unreadable Vitest 4.1.10 scheduling metadata only'};
}
export function skipTestMetadata(file,real,metadata) {
  if(real!==metadata.file)return false;
  assert.equal(file,real,'No runtime metadata symlink aliases');return true;
}
export function dependencyReadGrants(root,metadata) {
  assert.equal(fs.realpathSync(root),root);
  const rows=[],seen=new Set();
  const ancestor=file=>metadata.file.startsWith(file+path.sep);
  const descend=directory=>{
    if(seen.has(directory))return;seen.add(directory);
    rows.push([directory,'L']);
    for(const name of fs.readdirSync(directory).sort()) {
      const file=path.join(directory,name);if(file===metadata.file)continue;
      const real=fs.realpathSync(file),stat=fs.statSync(real);
      // A recursive grant on root never covered a symlink target outside root.
      if(real!==root&&!real.startsWith(root+path.sep))continue;
      if(ancestor(file)) {assert.equal(real,file,'Canonical metadata grant ancestry');assert.ok(stat.isDirectory());descend(file);}
      else if(ancestor(real)) {assert.ok(stat.isDirectory());descend(real);}
      else {assert.ok(real!==metadata.file,'No dependency alias grant to metadata');assert.ok(stat.isDirectory()||stat.isFile());rows.push([real,stat.isDirectory()?'D':'F']);}
    }
  };
  if(ancestor(root))descend(root);else rows.push([root,'D']);
  assertMetadataDenied(rows,metadata);return rows;
}
export function assertMetadataDenied(rows,metadata) {
  for(const [file,kind] of rows)assert.ok(!(file===metadata.file&&kind!=='L')&&!(kind==='D'&&metadata.file.startsWith(file+path.sep)),'Metadata must have no readable grant');
}
