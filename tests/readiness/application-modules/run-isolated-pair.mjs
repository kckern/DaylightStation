import {validateStudyWindow} from './synthetic-study-grant.mjs';
// A pair uses one independently prepared and explicitly pinned fixture/manifest.
// Projection remains the existing project-readonly-fixture.mjs command; no live calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareCapturedApi, validateCaptureManifest } from './api-comparator.mjs';
import { validateSelection, aggregateCases } from './run-readonly-suite.mjs';
import { validateRawFixtures, validateDirectoryFixtures } from './raw-utf8-fixture.mjs';
import { validateTestMetadata, skipTestMetadata } from './runtime-test-metadata.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const jsonHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function revision(root) {const r=spawnSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim();}
function sourceInventory(root) {
  const r=spawnSync('/usr/bin/git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(r.status,0);
  const allowed=/^(backend\/(src|assets)|frontend\/src|shared|modules|capabilities)\/.+\.(mjs|js|cjs|jsx|json|ya?ml|scss|css|svg|png|jpg|jpeg|webp|txt|ttf|otf|html|glsl|glslp|musicxml|py)$/;
  const names=r.stdout.split('\0').filter(p=>allowed.test(p)&&p!=='backend/src/5_composition/serverMain.mjs'&&fs.existsSync(path.join(root,p)));
  names.push('package.json','backend/package.json','frontend/package.json');
  return names.sort((a,b)=>a.localeCompare(b)).map(p=>{const file=path.join(root,p);assert.equal(fs.realpathSync(file),file);assert.ok(fs.lstatSync(file).isFile());return {path:p,sha256:hash(file)};});
}
export function treeInventory(roots,metadata) {
  const seen=new Set(),rows=[];
  const visit=file=>{
    const real=fs.realpathSync(file);if(skipTestMetadata(file,real,metadata))return;if(real!==file)rows.push({file,realpath:real});
    if(seen.has(real))return;seen.add(real);const stat=fs.statSync(real);
    if(stat.isDirectory()){const entries=fs.readdirSync(real).sort();rows.push({file:real,entries});for(const name of entries)visit(path.join(real,name));}
    else if(stat.isFile())rows.push({file:real,sha256:hash(real)});
    else assert.fail('Unexpected runtime input');
  };for(const root of roots)visit(root);return rows.sort((a,b)=>a.file.localeCompare(b.file));
}
export function collectPairInputs({originalRoot,candidateRoot,toolRoot}) {
  const native=spawnSync('/usr/bin/ldd',['/usr/bin/pdftotext'],{encoding:'utf8',timeout:5000});assert.equal(native.status,0);
  const libraries=[...native.stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)].map(match=>fs.realpathSync(match[1]));
  const metadata=validateTestMetadata(toolRoot);
  const runtime=treeInventory([...libraries,...['librt.so.1','libuuid.so.1','libresolv.so.2'].map(name=>fs.realpathSync('/lib/x86_64-linux-gnu/'+name)),fs.realpathSync(process.execPath),...['','backend','frontend'].flatMap(scope=>[path.join(toolRoot,scope,'package.json'),path.join(toolRoot,scope,'node_modules')])],metadata);
  runtime.push(metadata);
  const harness=fs.readdirSync(directory).filter(p=>/\.(mjs|json|py)$/.test(p)).sort().map(p=>({file:path.join(directory,p),sha256:hash(path.join(directory,p))}));
  const launcher=path.resolve(directory,'../../preimplementation/application-modules/tooling/landlock-runner.c');harness.push({file:launcher,sha256:hash(launcher)});
  return {original:{sourceCommit:revision(originalRoot),inventory:sourceInventory(originalRoot)},candidate:{sourceCommit:revision(candidateRoot),inventory:sourceInventory(candidateRoot)},runtime,harness};
}
function guardBacking(rows) {
  for(const row of rows){
    if(row.absent){assert.ok(!fs.existsSync(row.path),'Backing absence drift');continue;}
    assert.equal(fs.realpathSync(row.path),row.path);const stat=fs.statSync(row.path);
    assert.equal(stat.dev,row.dev);assert.equal(stat.ino,row.ino);
    if(row.kind==='directory')assert.deepEqual(fs.readdirSync(row.path).sort(),row.entries);
    else if(row.kind==='directory-identity')assert.ok(stat.isDirectory());
    else assert.equal(hash(row.path),row.sha256,'Backing byte drift');
  }
}
export async function main(argv=process.argv.slice(2)) {
  const keys=['original-root','candidate-root','tool-root','output-root','fixture','manifest','proof'];const o={};
  for(let i=0;i<argv.length;i+=2){const key=argv[i]?.replace(/^--/,'');assert.ok(keys.includes(key)&&!Object.hasOwn(o,key)&&path.isAbsolute(argv[i+1]??''),'Explicit absolute pair options required');o[key]=fs.realpathSync(argv[i+1]);}
  for(const key of keys)assert.ok(o[key],'Missing --'+key);
  const output=o['output-root'];assert.equal(fs.readdirSync(output).length,0,'Fresh empty private output required');fs.chmodSync(output,0o700);
  for(const root of [o['original-root'],o['candidate-root'],o['tool-root']])assert.ok(output!==root&&!output.startsWith(root+path.sep),'Output outside sources/tools');
  const result={schema:'daylight.isolated-api-pair/v1',readinessAccepted:false,productionOrLiveCoverage:false,scope:'Selected actual HTTP cases on sequential source processes using identical isolated fixture and current installed dependencies; no original production image or live coverage',runs:[],errors:[]};
  try {
    const proof=json(o.proof),manifest=json(o.manifest),fixture=json(o.fixture);
    assert.equal(proof.schema,'daylight.isolated-api-pair-proof/v1');assert.equal(proof.reviewed,true);
    assert.equal(hash(o.fixture),proof.fixtureFileSha256);assert.equal(hash(o.manifest),proof.manifestFileSha256);
    validateCaptureManifest(manifest,proof.fixtureFileSha256);validateStudyWindow(manifest,Date.now(),true);validateSelection(manifest,proof.cases,{isolatedStudyFixtureFileSha256:proof.fixtureFileSha256});
    validateRawFixtures(fixture);validateDirectoryFixtures(fixture);
    const proofSha256=hash(o.proof);
    const inputs=collectPairInputs({originalRoot:o['original-root'],candidateRoot:o['candidate-root'],toolRoot:o['tool-root']});
    assert.equal(jsonHash(inputs.original),proof.originalSha256,'Original inventory admission');assert.equal(jsonHash(inputs.candidate),proof.candidateSha256,'Candidate inventory admission');
    const runtimeSha256=jsonHash(inputs.runtime),harnessSha256=jsonHash(inputs.harness);
    assert.equal(runtimeSha256,proof.runtimeSha256,'Runtime admission');assert.equal(harnessSha256,proof.harnessSha256,'Harness admission');
    write(path.join(output,'input-inventory.json'),inputs);
    const guard=()=>{
      assert.equal(hash(o.proof),proofSha256,'Proof drift');assert.equal(hash(o.fixture),proof.fixtureFileSha256,'Fixture drift');assert.equal(hash(o.manifest),proof.manifestFileSha256,'Manifest drift');
      const current=collectPairInputs({originalRoot:o['original-root'],candidateRoot:o['candidate-root'],toolRoot:o['tool-root']});assert.deepEqual(current,inputs,'Source/harness/runtime inventory drift');guardBacking(proof.backingInputs??[]);
    };
    guardBacking(proof.backingInputs??[]);const pairNonce=randomBytes(16).toString('hex');result.pairNonce=pairNonce;result.proofSha256=proofSha256;
    for(const role of ['original','candidate']) {
      validateStudyWindow(manifest,Date.now());
      const roleOutput=path.join(output,role);fs.mkdirSync(roleOutput,{mode:0o700});
      const fd=fs.openSync(path.join(output,role+'.log'),'wx',0o600);
      let execution;try{execution=spawnSync(process.execPath,[path.join(directory,'run-local-app.mjs'),'--source-root',o[role+'-root'],'--tool-root',o['tool-root'],'--output-root',roleOutput,'--fixture',o.fixture,'--manifest',o.manifest,'--capture-role',role,'--pair-nonce',pairNonce,'--runtime-sha256',runtimeSha256,'--harness-sha256',harnessSha256],{stdio:['ignore',fd,fd],timeout:85000,killSignal:'SIGKILL'});}finally{fs.closeSync(fd);}
      guard();assert.equal(execution.status,0,role+' capture failed; see private log');assert.equal(execution.signal,null);
      const dirs=fs.readdirSync(roleOutput).filter(p=>p.startsWith('daylight-local-http-'));assert.equal(dirs.length,1);
      const receiptFile=path.join(roleOutput,dirs[0],'receipt.json'),receipt=json(receiptFile);
      assert.ok(receipt.completed&&receipt.controls&&receipt.protectedInputsUnchanged&&receipt.capture);
      assert.equal(receipt.sourceCommit,inputs[role].sourceCommit);
      for(const row of receipt.sourceInputs)assert.equal(hash(row.file),row.sha256,'Protected execution input drift');
      assert.equal(receipt.capture.workingTreeSha256,jsonHash(inputs[role].inventory),'Runtime source inventory linkage');
      result.runs.push({role,sourceCommit:inputs[role].sourceCommit,workingTreeSha256:receipt.capture.workingTreeSha256,capture:{file:receipt.capture.file,sha256:receipt.capture.sha256},receipt:{file:receiptFile,sha256:hash(receiptFile)}});
    }
    result.guardsAccepted=true;
    const comparison=await compareCapturedApi({manifest,manifestSha256:jsonHash(manifest),pairNonce,fixtureFileSha256:proof.fixtureFileSha256,runtimeSha256,harnessSha256,runs:result.runs,guardsAccepted:true});
    write(path.join(output,'comparison.json'),comparison);result.comparison=path.join(output,'comparison.json');
    result.aggregate=aggregateCases([{name:proof.name??'selected-isolated',approvals:proof.cases,admittedSelection:{proof,manifest,fixtureFileSha256:hash(o.fixture),manifestFileSha256:hash(o.manifest)},cases:comparison.cases,comparison:result.comparison,receipt:result.runs.map(r=>r.receipt.file)}]);
    guard();result.executionAccepted=true;result.equivalenceAccepted=comparison.accepted;
  }catch(error){result.errors.push(error.stack);result.executionAccepted=false;result.equivalenceAccepted=false;}
  write(path.join(output,'pair-result.json'),result);
  process.stdout.write(JSON.stringify({artifact:path.join(output,'pair-result.json'),executionAccepted:result.executionAccepted,equivalenceAccepted:result.equivalenceAccepted,readinessAccepted:false})+'\n');
  return result.executionAccepted&&result.equivalenceAccepted?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.exitCode=await main();
