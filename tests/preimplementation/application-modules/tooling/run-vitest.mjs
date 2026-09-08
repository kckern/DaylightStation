/** Exact allowlisted Vitest discovery or unchanged selected original suites. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root,packet} from './census.mjs';
const mode=process.argv[2];if(!['discover','stored-shape','print-gateway','default-discover'].includes(mode))throw new Error('Choose discover, default-discover, stored-shape or print-gateway');
const expectedCases={'stored-shape':6,'print-gateway':1};
const discovery=mode==='discover'||mode==='default-discover';
const toolRoot=fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const runRoot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'daylight-vitest-preparation-')));
const testRoot=path.join(root,'tests/preimplementation/application-modules');
const params={WORKTREE:root,RUN_ROOT:runRoot,ROOT_DEPS:path.join(toolRoot,'node_modules'),BACKEND_DEPS:path.join(toolRoot,'backend/node_modules'),FRONTEND_DEPS:path.join(toolRoot,'frontend/node_modules'),ROOT_MANIFEST:path.join(toolRoot,'package.json'),BACKEND_MANIFEST:path.join(toolRoot,'backend/package.json'),FRONTEND_MANIFEST:path.join(toolRoot,'frontend/package.json')};
const cli=path.join(toolRoot,'node_modules/vitest/vitest.mjs');
const vitestArgs=discovery?['list','--filesOnly','--json']:['run','--reporter=json','--outputFile='+path.join(runRoot,'result.json')];
const args=[...Object.entries(params).flatMap(([k,v])=>['-D',`${k}=${v}`]),'-f',path.join(testRoot,'configs/node.sbp'),process.execPath,'--experimental-loader',path.join(testRoot,'drivers/baseline-loader.mjs'),cli,...vitestArgs,'--config',path.join(testRoot,mode==='default-discover'?'configs/default-discovery.mjs':'configs/vitest.config.mjs'),'--configLoader','native'];
const result=spawnSync('/usr/bin/sandbox-exec',args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',NODE_ENV:'test',TZ:'UTC',PRE_RUN_ROOT:runRoot,PRE_TOOLCHAIN_ROOT:toolRoot,PRE_VITEST_MODE:mode,TMPDIR:runRoot,XDG_CACHE_HOME:path.join(runRoot,'cache')}});
const clean=s=>String(s||'').replaceAll(root,'<worktree>').replaceAll(toolRoot,'<installed-toolchain>').replaceAll(runRoot,'<run-root>').replaceAll('/opt/homebrew','<system-toolchain>');
const inputs=['configs/node.sbp','configs/vitest.config.mjs','configs/default-discovery.mjs','drivers/baseline-loader.mjs','tooling/run-vitest.mjs','tooling/census.mjs'];
let outcome=null;try{outcome=JSON.parse(discovery?result.stdout:fs.readFileSync(path.join(runRoot,'result.json'),'utf8'));}catch{}
const name='vitest-'+mode+'-'+new Date().toISOString().replaceAll(':','-')+'.json';
const populationMatches=discovery?Array.isArray(outcome):outcome?.numTotalTests===expectedCases[mode]
  &&outcome.numPassedTests===expectedCases[mode]&&outcome.numFailedTests===0
  &&outcome.testResults?.flatMap(r=>r.assertionResults).length===expectedCases[mode]
  &&outcome.testResults.every(r=>r.assertionResults.every(a=>a.status==='passed'));
const report={schema:'daylight.preimplementation.vitest-run/v1',id:'RUN-VITEST-'+Date.now(),capturedAt:new Date().toISOString(),mode,node:process.version,baseline:JSON.parse(fs.readFileSync(path.join(packet,'baseline.json'))).revision,command:'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-vitest.mjs '+mode,exitCode:result.status,signal:result.signal,populationMatches,stdout:clean(result.stdout),stderr:clean(result.stderr),outcome:outcome?JSON.parse(clean(JSON.stringify(outcome))):null,inputs:inputs.map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(path.join(testRoot,name))).digest('hex')})),limits:[mode==='default-discover'?'Existing root include/exclude/alias policy with only cache/watch/HMR/server safety overrides; installed-scope bridge is not native worktree install proof':'Dedicated discovery is not existing root configuration discovery','Files-only mode does not import test bodies or expand parameterized cases','Execution modes run only allowlisted unchanged original assertions: six stored-shape or one temporary-print gateway; no broader suite claim']};
fs.writeFileSync(path.join(packet,'evidence',name),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({evidence:'evidence/'+name,exitCode:result.status,outcome:outcome?{files:Array.isArray(outcome)?outcome.length:null,passed:outcome.numPassedTests,failed:outcome.numFailedTests}:null})+'\n');
if(result.status!==0||!outcome||!populationMatches){process.stdout.write(clean(result.stdout)+'\n'+clean(result.stderr));process.exitCode=1;}
