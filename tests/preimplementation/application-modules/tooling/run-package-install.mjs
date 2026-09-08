/** Offline nested workspace installation in disposable OS-owned data only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {root,packet} from './census.mjs';
const self=fileURLToPath(import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const worker=process.argv[2]==='--worker';
const toolRoot=fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
if(worker){
  const runRoot=fs.realpathSync(process.env.PRE_RUN_ROOT);
  if(!path.basename(runRoot).startsWith('daylight-package-preparation-'))throw new Error('Refuse non-task root');
  const fixture=path.join(runRoot,'fixture');fs.mkdirSync(fixture);
  const write=(name,data)=>{const full=path.join(fixture,name);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');};
  const vendor=(scope,name,target)=>{const from=path.join(toolRoot,scope,'node_modules',name),to=path.join(fixture,'vendor',target);fs.cpSync(from,to,{recursive:true,dereference:true});const manifest=JSON.parse(fs.readFileSync(path.join(to,'package.json')));return {from,to,manifest};};
  const moment=vendor('backend','moment','moment');
  const server=vendor('backend','moment-timezone','timezone-server');
  const web=vendor('frontend','moment-timezone','timezone-web');
  assert.equal(server.manifest.version,'0.6.0');assert.equal(web.manifest.version,'0.5.47');
  // Preserve runtime bytes but pin vendor dependency metadata to local source.
  // This does not certify the full original lock/range/peer graph.
  for(const item of [server,web]){item.manifest.dependencies={moment:'file:'+moment.to};fs.writeFileSync(path.join(item.to,'package.json'),JSON.stringify(item.manifest,null,2)+'\n');}
  write('package.json',{name:'daylight-offline-facet-probe',version:'1.0.0',private:true,type:'module',workspaces:['owner/public','owner/server','owner/web'],dependencies:{'@daylight/probe':'1.0.0'}});
  write('owner/public/package.json',{name:'@daylight/probe',version:'1.0.0',private:true,type:'module',exports:{'./server/operation':'./server.mjs','./web/surface':'./web.mjs'},dependencies:{'@daylight-internal/probe--server':'1.0.0','@daylight-internal/probe--web':'1.0.0'}});
  write('owner/public/server.mjs',"export {moment,run} from '@daylight-internal/probe--server/operation';");
  write('owner/public/web.mjs',"export {default} from '@daylight-internal/probe--web/surface';");
  write('owner/server/package.json',{name:'@daylight-internal/probe--server',version:'1.0.0',private:true,type:'module',imports:{'#value':'./value.js'},exports:{'./operation':'./operation.js'},dependencies:{'moment-timezone':'file:'+server.to}});
  write('owner/server/value.js','export default 42;');
  write('owner/server/operation.js',"import moment from 'moment-timezone';import value from '#value';export {moment};export const run=()=>value;");
  write('owner/web/package.json',{name:'@daylight-internal/probe--web',version:'1.0.0',private:true,type:'commonjs',exports:{'./surface':'./surface.js'},dependencies:{'moment-timezone':'file:'+web.to}});
  write('owner/web/surface.js',"module.exports={moment:require('moment-timezone'),render:()=> 'web'};");
  write('probe.mjs',`import assert from 'node:assert/strict';
    const paths=process.argv[2]==='web-first'?['@daylight/probe/web/surface','@daylight/probe/server/operation']:['@daylight/probe/server/operation','@daylight/probe/web/surface'];
    const values=[];for(const p of paths)values.push(await import(p));
    const server=values.find(v=>v.run),web=values.find(v=>v.default)?.default;
    assert.equal(server.run(),42);assert.equal(web.render(),'web');assert.notEqual(server.moment,web.moment,'MUST_SEPARATE_TIMEZONE_INSTANCES');assert.equal(server.moment.tz.version,'0.6.0');assert.equal(web.moment.tz.version,'0.5.47');
    const old=web.moment.tz.dataVersion;server.moment.tz.load({version:'audit-isolated',zones:[],links:[]});assert.equal(web.moment.tz.dataVersion,old);
    await assert.rejects(import('@daylight/probe/server/private.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    const again=await import('@daylight/probe/server/operation');assert.equal(again.moment,server.moment);
    process.stdout.write(JSON.stringify({order:process.argv[2],server:server.moment.tz.version,web:web.moment.tz.version,distinct:true,privateRejected:true,localImport:server.run()})+'\\n');`);
  const records=[];
  const run=(label,args,expectedExit=0,diagnostic=null)=>{const r=spawnSync(process.execPath,args,{cwd:fixture,env:process.env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});const expectedDiagnostic=diagnostic?r.stderr.includes(diagnostic):true;records.push({label,exitCode:r.status,expectedExit,expectedDiagnostic,stdout:r.stdout,stderr:r.stderr,error:r.error?.message});if(r.status!==expectedExit||!expectedDiagnostic)throw new Error(label+' failed: '+r.stderr);return r.stdout;};
  const npmArgs=['--offline','--ignore-scripts','--no-audit','--no-fund','--install-strategy=nested','--install-links','--cache',path.join(runRoot,'npm-cache'),'--userconfig',path.join(runRoot,'empty.npmrc')];
  fs.writeFileSync(path.join(runRoot,'empty.npmrc'),'');
  let outcome;
  try{
    run('initial-install',[process.env.PRE_NPM_CLI,'install',...npmArgs]);
    const lockBefore=sha(fs.readFileSync(path.join(fixture,'package-lock.json')));
    run('server-first',[path.join(fixture,'probe.mjs'),'server-first']);run('web-first',[path.join(fixture,'probe.mjs'),'web-first']);
    // npm ci performs its documented clean install within this synthetic prefix.
    run('clean-reinstall',[process.env.PRE_NPM_CLI,'ci',...npmArgs]);
    assert.equal(sha(fs.readFileSync(path.join(fixture,'package-lock.json'))),lockBefore);
    run('reinstalled-server-first',[path.join(fixture,'probe.mjs'),'server-first']);run('reinstalled-web-first',[path.join(fixture,'probe.mjs'),'web-first']);
    const webSource=fs.readFileSync(path.join(fixture,'owner/web/surface.js'),'utf8');
    write('owner/web/surface.js',"module.exports={moment:require('@daylight-internal/probe--server/operation').moment,render:()=> 'web'};");
    run('collapsed-instance-red',[path.join(fixture,'probe.mjs'),'server-first'],1,'MUST_SEPARATE_TIMEZONE_INSTANCES');
    write('owner/web/surface.js',webSource);
    run('restored-instance-green',[path.join(fixture,'probe.mjs'),'server-first']);
    const publicManifest=JSON.parse(fs.readFileSync(path.join(fixture,'owner/public/package.json')));
    const serverEntry=publicManifest.exports['./server/operation'];delete publicManifest.exports['./server/operation'];write('owner/public/package.json',publicManifest);
    run('missing-export-red',[path.join(fixture,'probe.mjs'),'server-first'],1,'ERR_PACKAGE_PATH_NOT_EXPORTED');
    publicManifest.exports['./server/operation']=serverEntry;write('owner/public/package.json',publicManifest);
    run('restored-export-green',[path.join(fixture,'probe.mjs'),'web-first']);
    outcome={passed:true,records,lockSha256:lockBefore,sourceRuntime:[server,web,moment].map(v=>({name:v.manifest.name,version:v.manifest.version,entrySha256:sha(fs.readFileSync(path.join(v.from,v.manifest.main||'index.js')))}))};
  }catch(error){outcome={passed:false,records,error:error.message};}
  fs.writeFileSync(path.join(runRoot,'outcome.json'),JSON.stringify(outcome,null,2));
  process.exitCode=outcome.passed?0:1;
}else{
  const runRoot=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'daylight-package-preparation-')));
  const npmCli=fs.realpathSync(path.join(path.dirname(process.execPath),'npm'));
  const profile=path.join(root,'tests/preimplementation/application-modules/configs/package-install.sbp');
  const params={WORKTREE:root,RUN_ROOT:runRoot,ROOT_DEPS:path.join(toolRoot,'node_modules'),BACKEND_DEPS:path.join(toolRoot,'backend/node_modules'),FRONTEND_DEPS:path.join(toolRoot,'frontend/node_modules'),NODE_BINARY:fs.realpathSync(process.execPath)};
  const args=[...Object.entries(params).flatMap(([k,v])=>['-D',`${k}=${v}`]),'-f',profile,process.execPath,self,'--worker'];
  const result=spawnSync('/usr/bin/sandbox-exec',args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',NODE_ENV:'test',TZ:'UTC',PRE_TOOLCHAIN_ROOT:toolRoot,PRE_RUN_ROOT:runRoot,PRE_NPM_CLI:npmCli,TMPDIR:runRoot,XDG_CACHE_HOME:path.join(runRoot,'cache')}});
  const clean=s=>String(s||'').replaceAll(root,'<worktree>').replaceAll(toolRoot,'<installed-toolchain>').replaceAll(runRoot,'<run-root>').replaceAll('/opt/homebrew','<system-toolchain>');
  const file='package-install-'+new Date().toISOString().replaceAll(':','-')+'.json';
  const outcomePath=path.join(runRoot,'outcome.json');const outcome=fs.existsSync(outcomePath)?JSON.parse(clean(fs.readFileSync(outcomePath,'utf8'))):null;
  const report={schema:'daylight.preimplementation.package-install/v1',id:'RUN-PACKAGE-INSTALL-'+Date.now(),capturedAt:new Date().toISOString(),pack:'package-install',baseline:JSON.parse(fs.readFileSync(path.join(packet,'baseline.json'))).revision,node:process.version,exitCode:result.status,signal:result.signal,command:'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-package-install.mjs',outcome,stdout:clean(result.stdout),stderr:clean(result.stderr),inputs:[self,profile].map(p=>({name:path.relative(path.join(root,'tests/preimplementation/application-modules'),p),sha256:sha(fs.readFileSync(p))})),limits:['Real runtime package bytes; vendor dependency metadata pinned to local file sources for offline experiment','Not the complete three original lock/range/peer graphs, React context identity or Linux native adoption proof','All install/cache/source output is disposable; no repository install mutation','OS denies network/private roots and executable launches except this Node binary; lifecycle scripts ignored']};
  fs.writeFileSync(path.join(packet,'evidence',file),JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({evidence:'evidence/'+file,exitCode:result.status,passed:outcome?.passed,steps:outcome?.records.map(r=>({label:r.label,exitCode:r.exitCode})),error:outcome?.error,stderr:clean(result.stderr)})+'\n');if(result.status!==0||!outcome?.passed)process.exitCode=1;
}
