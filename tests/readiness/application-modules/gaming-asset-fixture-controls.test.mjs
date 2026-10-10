import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateRawFixtures,materializeTimedImageFixtures} from './raw-utf8-fixture.mjs';
const destinations=['media/games/_common/synthetic-read-assets/tiles.png','media/games/party-games/synthetic-read-assets.png','media/school/language/synthetic-read-assets/words/en/star/image.png'];
const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);
const fixture=()=>({fixtureFiles:{},rawBinaryFiles:destinations.map(destination=>({destination,encoding:'binary',base64:bytes.toString('base64'),byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mtimeMs:1759276800000}))});
function scratch(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'readiness-gaming-image-control-'));try{fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('exact three timed image fixtures preserve bytes, input and fixed native mtime',()=>scratch(dir=>{
 const value=fixture(),before=JSON.stringify(value);assert.equal(validateRawFixtures(value).length,0);
 const seen=materializeTimedImageFixtures(value,dir);assert.equal(seen.length,3);assert.equal(JSON.stringify(value),before);
 for(const row of value.rawBinaryFiles){const file=path.join(dir,row.destination);assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.statSync(file).mtimeMs,row.mtimeMs);}
}));
test('timed metadata refuses sibling/raw-type/unreviewed-mtime before writes',()=>scratch(dir=>{
 for(const change of [r=>r.destination='media/games/_common/synthetic-read-assets/other.png',r=>r.mtimeMs++,r=>delete r.mtimeMs,r=>r.encoding='utf8']){const value=fixture();change(value.rawBinaryFiles[0]);assert.throws(()=>materializeTimedImageFixtures(value,dir));assert.deepEqual(fs.readdirSync(dir),[]);}
 const value={fixtureFiles:{},rawUTF8Files:[{...fixture().rawBinaryFiles[0],destination:'media/games/_common/catalog/synthetic-read-assets.yml',encoding:'utf8'}]};assert.throws(()=>validateRawFixtures(value));
}));
test('pre-existing file collision rejects before any other image is staged',()=>scratch(dir=>{
 const existing=path.join(dir,destinations[2]);fs.mkdirSync(path.dirname(existing),{recursive:true});fs.writeFileSync(existing,'preserved');
 assert.throws(()=>materializeTimedImageFixtures(fixture(),dir));assert.equal(fs.readFileSync(existing,'utf8'),'preserved');assert.equal(fs.existsSync(path.join(dir,destinations[0])),false);
}));
test('scratch/parent symlinks cannot direct staging outside private root',()=>scratch(dir=>scratch(outside=>{
 const outsideFile=path.join(outside,'untouched');fs.writeFileSync(outsideFile,'kept');const before=fs.statSync(outsideFile).mtimeMs;
 fs.symlinkSync(outside,path.join(dir,'media'),'dir');assert.throws(()=>materializeTimedImageFixtures(fixture(),dir));assert.deepEqual(fs.readdirSync(outside),['untouched']);assert.equal(fs.statSync(outsideFile).mtimeMs,before);
 const alias=path.join(dir,'alias');fs.symlinkSync(outside,alias,'dir');assert.throws(()=>materializeTimedImageFixtures(fixture(),alias));
})));
