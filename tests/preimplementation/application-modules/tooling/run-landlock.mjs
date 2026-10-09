/** Fixed Linux baseline adapter: no installs, runtime entrypoint, candidate or shell commands. */
import fs from 'node:fs';
import {m2Selected} from '../configs/m2-selected.mjs';
const vitestPacks=['stored-shape','integration','m2'];

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fs.realpathSync(new URL('../../../../',import.meta.url));
const tests=path.join(root,'tests/preimplementation/application-modules');
if (process.platform!=='linux' || process.arch!=='x64') throw new Error('Linux x86_64 required');
const pack=process.argv[2];
if (process.argv.length!==3 || !['gratitude','browser','stored-shape','integration','m2'].includes(pack)) throw new Error('Only fixed gratitude/browser/stored-shape packs are implemented');
const target=process.env.PRE_TARGET||'baseline';
if(!['baseline','candidate'].includes(target) || target==='candidate'&&!['gratitude','browser','m2'].includes(pack)) throw new Error('Only Gratitude/browser candidate targets are implemented');
let baseline=null,baselineFile='';
if(target==='candidate'){
 if(!process.env.PRE_BASELINE_EVIDENCE) throw new Error('Prior green Gratitude baseline receipt required');
 baselineFile=fs.realpathSync(process.env.PRE_BASELINE_EVIDENCE);
 baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
 if(baseline.target!=='baseline'||baseline.pack!==pack||baseline.exitCode!==0||!baseline.controls||!baseline.protectedInputsUnchanged||baseline.passed?.length!==(pack==='gratitude'?59:pack==='m2'?145:25)||baseline.failed?.length||baseline.incomplete) throw new Error('Invalid prior green selected-pack baseline');
}
if (!process.env.PRE_TOOLCHAIN_ROOT) throw new Error('Explicit PRE_TOOLCHAIN_ROOT required');
const toolRoot=fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const evidence=path.join(root,'.superpowers/sdd/2026-10-08-gratitude-module-proof/landlock-runs');
fs.mkdirSync(evidence,{recursive:true});
const directory=fs.mkdtempSync(path.join(evidence,pack+'-'));
const scratch=path.join(directory,'scratch'),denied=path.join(directory,'denied');
fs.mkdirSync(scratch); fs.mkdirSync(denied);
const sentinel=path.join(denied,'private.env');
fs.writeFileSync(sentinel,'synthetic private sentinel\n');
const forbidden=new Set(['backend/index.js','backend/src/app.mjs','backend/src/5_composition/bootstrap.mjs']);
const git=spawnSync('/usr/bin/git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
if(git.status!==0) throw new Error('Tracked source enumeration failed');
const scope=['browser','integration','m2'].includes(pack)?/^(frontend\/src|backend\/src|shared)\/.+\.(mjs|js|cjs|jsx|scss|css|svg|glsl)$/:/^(backend\/src|shared)\/.+\.(mjs|js|cjs)$/;
const source=git.stdout.split('\0').filter(name=>scope.test(name) && !forbidden.has(name)).map(name=>path.join(root,name)).filter(file=>fs.existsSync(file));
const caseFile=vitestPacks.includes(pack)?path.join(root,'tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs'):path.join(tests,'cases/'+pack+'.case.mjs');
if(['integration','m2'].includes(pack)) source.push(...git.stdout.split('\0').filter(n=>/^(tests\/(isolated|unit)|backend\/src)\/.+\.(mjs|js|jsx)$/.test(n)&&fs.existsSync(path.join(root,n))).map(n=>path.join(root,n)));
if(pack==='m2')source.push(path.join(root,'tests/_infrastructure/frontend-env.mjs'),...m2Selected.map(file=>path.join(root,file)));
source.push(path.join(tests,'configs/m2-selected.mjs'));
source.push(caseFile,fileURLToPath(import.meta.url),path.join(root,'backend/src/0_system/libraries/gratitudeRuntime.mjs'));
for(const owner of ['modules/gratitude/server','capabilities/household-identity/server','modules/gratitude/browser','capabilities/household-identity/browser',...pack==='m2'?['modules/piano/server','modules/piano/browser','capabilities/playback/server','capabilities/playback/browser','capabilities/screen-host/browser','frontend/src/composition/screens','frontend/src/lib/diagnostics']:[]]){
 const directory=path.join(root,owner);
 if(fs.existsSync(directory)){ const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.name==='node_modules'||item.isSymbolicLink())continue;const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.(mjs|js|jsx|scss|css|svg|glsl)$/.test(item.name))source.push(file);}};walk(directory);}
}
if(vitestPacks.includes(pack)) source.push(path.join(tests,'configs/vitest.config.mjs'));
for(const name of fs.readdirSync(path.join(tests,'drivers'))) if(/\.(mjs|js|jsx|scss|css|svg|glsl)$/.test(name)) source.push(path.join(tests,'drivers',name));
const grants=new Map();
for(const file of source){
  const canonical=fs.realpathSync(file);
  if(!canonical.startsWith(root+path.sep)) throw new Error('Source symlink outside worktree refused');
  grants.set(canonical,'F');
}
for(const scope of ['','backend','frontend']){
  grants.set(fs.realpathSync(path.join(root,scope,'package.json')),'F');
  grants.set(fs.realpathSync(path.join(toolRoot,scope,'package.json')),'F');
  grants.set(fs.realpathSync(path.join(toolRoot,scope,'node_modules')),'D');
}
if(vitestPacks.includes(pack)) for(const file of source) for(let dir=path.dirname(file);dir.startsWith(root);dir=path.dirname(dir)) grants.set(dir,'L');
if(vitestPacks.includes(pack)) grants.set(fs.realpathSync('/lib/x86_64-linux-gnu/librt.so.1'),'F');
if(vitestPacks.includes(pack)) grants.set(fs.realpathSync(path.join(toolRoot,'node_modules/@esbuild/linux-x64/bin/esbuild')),'X');
if(pack==='browser') grants.set(fs.realpathSync(path.join(toolRoot,'frontend/node_modules/@esbuild/linux-x64/bin/esbuild')),'X');
if(['integration','m2'].includes(pack)){
 for(const lib of ['libuuid.so.1','libresolv.so.2'])grants.set(fs.realpathSync('/lib/x86_64-linux-gnu/'+lib),'F');
 source.push(path.join(root,'backend/assets/fonts/roboto-condensed/RobotoCondensed-Regular.ttf'));
 grants.set(fs.realpathSync(source.at(-1)),'F');
 fs.writeFileSync(path.join(scratch,'fonts.conf'),'<fontconfig><cachedir>'+scratch+'/font-cache</cachedir></fontconfig>');
}
if(['integration','m2'].includes(pack)) for(const scope of ['','frontend']){
 grants.set(fs.realpathSync(path.join(toolRoot,scope,'node_modules/@esbuild/linux-x64/bin/esbuild')),'X');
 const dart=path.join(toolRoot,scope,'node_modules/sass-embedded-linux-x64/dart-sass/src/dart');if(fs.existsSync(dart))grants.set(fs.realpathSync(dart),'X');
}
const manifest=path.join(directory,'read-allowlist.tsv');
const entries=[...grants].sort(([a],[b])=>a.localeCompare(b));
if(entries.some(([p])=>/[\r\n\t]/.test(p))) throw new Error('Unsafe manifest pathname');
fs.writeFileSync(manifest,entries.map(([p,t])=>`${t}\t${p}\n`).join(''));
fs.writeFileSync(path.join(scratch,'openssl.cnf'),'');
if(['integration','m2'].includes(pack))fs.writeFileSync(path.join(scratch,'styles.css'),'');
if(['integration','m2'].includes(pack))fs.writeFileSync(path.join(scratch,'vitest-setup.mjs'),`import {afterEach,expect} from 'vitest';import * as matchers from ${JSON.stringify('file://'+path.join(toolRoot,'frontend/node_modules/@testing-library/jest-dom/dist/matchers.mjs'))};expect.extend(matchers);if(typeof document!=='undefined'){const {cleanup}=await import(${JSON.stringify('file://'+path.join(toolRoot,'frontend/node_modules/@testing-library/react/dist/index.js'))});afterEach(cleanup);}`);
const uuidManifest=JSON.parse(fs.readFileSync(path.join(toolRoot,'backend/node_modules/uuid/package.json'),'utf8'));
const nativeUuid=path.join(toolRoot,'backend/node_modules/uuid',uuidManifest.exports['.'].node.import);
const nativeCode=`const assert=require('node:assert/strict'); (async()=>{
 const owner=await import(${JSON.stringify('file://'+path.join(root,'modules/gratitude/server/public.mjs'))});
 const bridge=await import(${JSON.stringify('file://'+path.join(root,'backend/src/0_system/libraries/gratitudeRuntime.mjs'))});
 const uuid=await import(${JSON.stringify('file://'+nativeUuid)});
 const moment=await import(${JSON.stringify('file://'+path.join(toolRoot,'backend/node_modules/moment-timezone/index.js'))});
 assert.equal(bridge.uuidv4,uuid.v4); assert.equal(bridge.moment,moment.default);
 assert.deepEqual(Object.keys(owner).sort(),['createGratitudeApiRouter','createGratitudeServices']);
 ${pack==='m2'?`const piano=await import(${JSON.stringify('file://'+path.join(root,'modules/piano/server/composition.mjs'))});const playback=await import(${JSON.stringify('file://'+path.join(root,'capabilities/playback/server/public.mjs'))});assert.equal(typeof piano.createPianoModule,'function');assert.equal(typeof playback.PlaybackSessionRegistry,'function');assert.equal(typeof playback.ReportPlaybackSession,'function');`:''}
 process.stdout.write('NATIVE PUBLIC ESM PASS');
})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
const controlSource=caseFile;
const entry=path.join(scratch,'entry.mjs');
fs.writeFileSync(entry,`import fs from 'node:fs';

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const sentinel=${JSON.stringify(sentinel)}, source=${JSON.stringify(controlSource)};
const denied=(name,fn)=>{assert.throws(fn,e=>['EACCES','EPERM'].includes(e.code),name); process.stdout.write('CONTROL '+name+': denied\\n');};
fs.writeFileSync('permitted.txt','scratch only\\n'); assert.equal(fs.readFileSync('permitted.txt','utf8'),'scratch only\\n');
denied('outside read',()=>fs.readFileSync(sentinel));
denied('outside write',()=>fs.writeFileSync(sentinel,'changed'));
denied('outside truncate',()=>fs.truncateSync(sentinel,0));
denied('source write',()=>fs.openSync(source,'w'));
denied('source truncate',()=>fs.truncateSync(source,0));
denied('host read',()=>fs.readFileSync('/etc/hostname'));
fs.symlinkSync(sentinel,'escape');
denied('symlink read',()=>fs.readFileSync('escape'));
denied('symlink write',()=>fs.writeFileSync('escape','changed'));
if (${JSON.stringify(pack)}==='gratitude') {
  assert.equal(spawnSync(process.execPath,['-e','process.exit(0)']).error?.code,'EPERM');
} else {
  const childCode="const fs=require('node:fs'),assert=require('node:assert/strict'),net=require('node:net'); const deny=fn=>assert.throws(fn,e=>['EACCES','EPERM'].includes(e.code)); deny(()=>fs.readFileSync("+JSON.stringify(sentinel)+")); deny(()=>fs.writeFileSync("+JSON.stringify(sentinel)+",'changed')); deny(()=>fs.readFileSync('/etc/hostname')); const server=net.createServer(); server.on('error',e=>{assert.equal(e.code,'EPERM'); process.stdout.write('CHILD CONTROLS PASS');}); server.listen(0);";
  const child=spawnSync(process.execPath,['--openssl-config=openssl.cnf','-e',childCode],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr+JSON.stringify({error:child.error?.message,signal:child.signal})); assert.equal(child.stdout,'CHILD CONTROLS PASS');
  process.stdout.write('CHILD CONTROLS PASS\\n');
  const native=spawnSync(process.execPath,['--openssl-config=openssl.cnf','-e',${JSON.stringify(nativeCode)}],{encoding:'utf8'});
  assert.equal(native.status,0,native.stderr); assert.equal(native.stdout,'NATIVE PUBLIC ESM PASS');
  process.stdout.write('NATIVE PUBLIC ESM PASS\\n');
}

process.stdout.write('CONTROLS PASS\\n');
${target==='candidate'&&pack==='gratitude'?`const owner=await import(${JSON.stringify('file://'+path.join(root,'modules/gratitude/server/public.mjs'))});
const raw=[{item:'legacy synthetic quote'}], reads=[];
const owned=owner.createGratitudeServices({dataService:{household:{read:p=>{reads.push(p);return raw;},write(){}}},logger:{}});
assert.equal(owned.readSelectionQuotes(),raw); assert.deepEqual(reads,['gratitude/selections.gratitude.yml']);
const args=['household','gratitude','alex',[{text:'synthetic'}],'timestamp'], result={synthetic:true};
owned.gratitudeService.addSelections=(...actual)=>{assert.deepEqual(actual,args);return result;};
assert.equal(owned.addSelections(...args),result);
assert.deepEqual(Object.keys(owner).sort(),['createGratitudeApiRouter','createGratitudeServices']);
process.stdout.write('CANDIDATE OWNER CONTROLS PASS\\n');`:''}

${vitestPacks.includes(pack)?`process.env.PRE_VITEST_MODE=${JSON.stringify(pack)};process.env.HOME=process.env.PRE_RUN_ROOT;process.env.OPENSSL_CONF=process.env.PRE_RUN_ROOT+'/openssl.cnf';if(${JSON.stringify(pack)}==='integration')process.env.FONTCONFIG_FILE=process.env.PRE_RUN_ROOT+'/fonts.conf';process.argv=[process.execPath,${JSON.stringify(path.join(toolRoot,'node_modules/vitest/vitest.mjs'))},'run','--reporter=json','--outputFile='+${JSON.stringify(path.join(scratch,'vitest-result.json'))},'--config',${JSON.stringify(path.join(tests,'configs/vitest.config.mjs'))},'--configLoader','native']; await import(${JSON.stringify('file://'+path.join(toolRoot,'node_modules/vitest/vitest.mjs'))});`:`await import(${JSON.stringify(new URL('../cases/'+pack+'.case.mjs',import.meta.url).href)});`}
`);
const c=path.join(tests,'tooling/landlock-runner.c'),binary=path.join(directory,'landlock-runner');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs=[...new Set([...source,c,fileURLToPath(import.meta.url),entry,...entries.filter(([,t])=>t==='F'||t==='X').map(([p])=>p)])].sort().map(file=>({file,sha256:hash(file)}));
const compile=spawnSync('/usr/bin/gcc',['-O2','-Wall','-Wextra','-Werror',c,'-o',binary],{encoding:'utf8',timeout:30000,env:{PATH:'/usr/bin:/bin'}});
if(compile.status!==0) throw new Error('Launcher compile failed: '+compile.stderr);
const args=[scratch,fs.realpathSync(process.execPath),manifest,toolRoot,path.join(tests,'drivers/baseline-loader.mjs'),entry,denied,pack,target,baselineFile];
const result=spawnSync('/usr/bin/timeout',['--signal=KILL','50s',binary,...args],{cwd:root,encoding:'utf8',timeout:55000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin'}});
const output=fs.existsSync(path.join(scratch,'result.txt'))?fs.readFileSync(path.join(scratch,'result.txt'),'utf8'):'';
let passed=[...output.matchAll(/^ok \d+ - (CASE-[^\n]+)/gm)].map(m=>m[1]);
let failed=[...output.matchAll(/^not ok \d+ - (CASE-[^\n]+)/gm)].map(m=>m[1]);
let incomplete=['skipped','todo','cancelled'].some(key=>Number(output.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]||0)>0);
let vitest=null;
if(vitestPacks.includes(pack) && fs.existsSync(path.join(scratch,'vitest-result.json'))){
 vitest=JSON.parse(fs.readFileSync(path.join(scratch,'vitest-result.json'),'utf8'));
 const assertions=vitest.testResults.flatMap(result=>result.assertionResults);
 passed=assertions.filter(a=>a.status==='passed').map(a=>a.fullName);
 failed=assertions.filter(a=>a.status==='failed').map(a=>a.fullName);
 incomplete=vitest.testResults.some(result=>result.status==='failed'&&!result.assertionResults.length)||assertions.some(a=>!['passed','failed'].includes(a.status)) || (pack==='stored-shape'?vitest.numTotalTests!==6:vitest.testResults.length!==(pack==='m2'?m2Selected.length:10));
}
if(pack==='m2'){passed.sort();failed.sort();}
const controls=output.includes('socket(AF_INET): EPERM\n') && (pack==='gratitude'?output.includes('fork: EPERM\n'):output.includes('CHILD CONTROLS PASS\n')) && output.includes('CONTROLS PASS\n') && (target!=='candidate'||pack!=='gratitude'||output.includes('CANDIDATE OWNER CONTROLS PASS\n')) && fs.readFileSync(sentinel,'utf8')==='synthetic private sentinel\n' && fs.readdirSync(denied).length===1;
const canonicalLibraries=[...output.matchAll(/^\{"canonicalLibrary":.*\}$/gm)].map(m=>JSON.parse(m[0]));
const nativePublicESM=output.includes('NATIVE PUBLIC ESM PASS\n');
const dependencyIdentity=target!=='candidate'||pack!=='gratitude'||['uuid','moment-timezone','express'].every(name=>canonicalLibraries.some(item=>item.canonicalLibrary===name&&item.resolved.startsWith(path.join(toolRoot,'backend/node_modules')+path.sep)));
const embedding=pack==='m2'?passed.filter(name=>name.includes('M2 embedding:')):[];
const parityPassed=passed.filter(name=>!embedding.includes(name));
const parity=baseline?parityPassed.length===baseline.passed.length && parityPassed.every((name,index)=>name===baseline.passed[index]) && !failed.length && !incomplete:null;
const protectedInputsUnchanged=inputs.every(input=>hash(input.file)===input.sha256);
const report={schema:'daylight.landlock.baseline/v1',capturedAt:new Date().toISOString(),target,pack,profile:pack==='gratitude'?'thread-only':'inherited-child',node:process.version,toolRoot,
 command:{executable:'/usr/bin/timeout',args:['--signal=KILL','50s',binary,...args]},exitCode:result.status,signal:result.signal,error:result.error?.message,controls,protectedInputsUnchanged,parity,dependencyIdentity,nativePublicESM,nativeUuid,canonicalLibraries,baselineEvidence:baselineFile||null,embedding,passed,failed,incomplete,vitest,inputs,compileCommand:{executable:'/usr/bin/gcc',args:['-O2','-Wall','-Wextra','-Werror',c,'-o',binary]},manifestSha256:hash(manifest),output,
 limitations:['No filesystem metadata concealment, PID namespace or cgroup quotas',`${pack==='gratitude'?2:4} GiB address space, ${pack==='gratitude'?64:256} MiB Node old-space, 20 CPU seconds, 45-second alarm, 50-second watchdog, 4 MiB per file, 128 descriptors; no aggregate disk/thread quota`,'Explicit installed node_modules directories permitted read only; this is not candidate parity or deployment validation']};
fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({receipt:path.relative(root,path.join(directory,'receipt.json')),exitCode:result.status,controls,protectedInputsUnchanged,parity,passed:passed.length,failed,incomplete})+'\n');
if(result.status!==0 || !controls || !protectedInputsUnchanged || !dependencyIdentity || pack!=='gratitude'&&!nativePublicESM || parity===false || (pack==='m2'&&target==='candidate'&&embedding.length!==1) || !passed.length || failed.length || incomplete){process.stdout.write(output+result.stderr);process.exitCode=1;}
