/** Fixed confined Java/JUnit35 pair: no downloads, commands, paths or flags from callers. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const bundle=path.dirname(fileURLToPath(import.meta.url));
const sourceRoot=fs.realpathSync(new URL('../../../../',import.meta.url));
if(process.argv.length!==3||process.argv[2]!=='--execute-reviewed-jvm35')throw Error('fixed reviewed execution opt-in required');
if(process.platform!=='linux'||process.arch!=='x64')throw Error('Linux x86_64 required');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const hash=p=>digest(fs.readFileSync(p));
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const bundlePins=JSON.parse(fs.readFileSync(path.join(bundle,'bundle-pins.json')));
for(const p of bundlePins.files)check(hash(path.join(bundle,p.name))===p.sha256,'review bundle changed: '+p.name);
const config=JSON.parse(fs.readFileSync(path.join(bundle,'selection.json')));
check(config.sources.length===29&&config.expectedMethods.length===35&&new Set(config.expectedMethods).size===35,'selection completeness');
check(config.mainPin==='0c660f6e7851bb2bd09fcbae3e76a0f09f73d1e8','wrong original pin');
const readGit=args=>{
 const r=spawnSync('/usr/bin/git',args,{cwd:sourceRoot,encoding:null,maxBuffer:4*1024*1024,timeout:15000,env:{PATH:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0',HOME:'/nonexistent'}});
 check(!r.error&&r.status===0,'fixed git read failed');return r.stdout;
};
const candidateHead=readGit(['rev-parse','HEAD']).toString().trim();
check(/^[0-9a-f]{40}$/.test(candidateHead),'candidate commit identity');
check(config.helperPin.relativePath==='tests/preimplementation/application-modules/tooling/landlock-runner.c','fixed helper selection');
const helperPin={...config.helperPin,path:path.join(sourceRoot,config.helperPin.relativePath)};
check(fs.realpathSync(helperPin.path)===helperPin.path,'helper symlink refused');
helperPin.canonical=helperPin.path;
for(const s of config.sources){
 check(/^_extensions\/piano-bridge\/app\/(payload|shell-api)\/src\/(main|test)\/java\/[A-Za-z0-9_/]+\.java$/.test(s.mainPath),'unexpected source path');
 check(s.candidatePath===s.mainPath.replace('_extensions/piano-bridge/','modules/piano/satellites/piano-bridge/'),'wrong mapping');
 const p=path.join(sourceRoot,s.candidatePath);check(fs.realpathSync(p)===p,'candidate symlink refused');
 check(hash(p)===s.candidateSha256,'candidate source changed');
}
const test=config.sources.find(s=>s.mainPath.endsWith('/KioskSettingsGuardTest.java'));
check(test&&test.sha256===test.candidateSha256,'actual assertions differ');
function verifyProtected(){
 check(readGit(['rev-parse','HEAD']).toString().trim()===candidateHead,'candidate HEAD moved during pair');
 for(const p of [...config.runtimePins,...config.buildToolPins,helperPin])check(fs.realpathSync(p.path)===p.canonical&&hash(p.path)===p.sha256,'runtime/helper changed: '+p.path);
 for(const s of config.sources)check(hash(path.join(sourceRoot,s.candidatePath))===s.candidateSha256,'candidate source changed');
 for(const p of bundlePins.files)check(hash(path.join(bundle,p.name))===p.sha256,'bundle changed');
}
verifyProtected();
const run=fs.mkdtempSync('/tmp/readiness-jvm35-');fs.chmodSync(run,0o700);
const inputs=path.join(run,'inputs'),build=path.join(run,'build');fs.mkdirSync(inputs);fs.mkdirSync(build);
const nonce=crypto.randomBytes(32).toString('hex');
const selectionDigest=hash(path.join(bundle,'selection.json'));
const receipt={schema:'daylight.confined-jvm35-pair/v1',run,nonce,mainPin:config.mainPin,candidateFreeze:{...config.candidateFreeze,head:candidateHead},selectionDigest,protectedPins:{runtime:config.runtimePins,buildTools:config.buildToolPins,helper:helperPin,sources:config.sources,bundle:bundlePins.files},javaCompatibilityScope:'-source11 -target11 on pinned JRE21: Java11 syntax/bytecode only; no Java11 API/platform or Android build compatibility certification (ct.sym absent)',androidScope:'shared unverified-origin unit stub; no API33/device/platform proof',roles:[],completed:false,correctness:false,controls:false,protectedInputsUnchanged:false,incomplete:true};
const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
save();
function runFixed(exe,args,cwd,timeout=60000){
 const result=spawnSync(exe,args,{cwd,encoding:'utf8',timeout,maxBuffer:4*1024*1024,killSignal:'SIGKILL',detached:true,env:{HOME:path.join(cwd,'home'),TMPDIR:path.join(cwd,'tmp'),PATH:'/nonexistent',LANG:'C.UTF-8',TZ:'UTC'}});
 // Never leave a descendant group alive, including after timeout.
 let alive=false;if(result.pid){try{process.kill(-result.pid,0);alive=true;process.kill(-result.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
 return {status:result.status,signal:result.signal,error:result.error?.message||null,stdout:result.stdout||'',stderr:result.stderr||'',leftoverGroup:alive};
}
function classPins(dir){
 const found=[];let bytes=0;
 function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);check(!e.isSymbolicLink(),'class symlink');
  if(e.isDirectory())walk(p);else{check(e.isFile()&&p.endsWith('.class'),'unexpected classes entry');const n=fs.statSync(p).size;bytes+=n;check(n<=1024*1024&&bytes<=8*1024*1024,'classes cap');found.push({name:path.relative(dir,p),sha256:hash(p)});}
 }}walk(dir);check(found.length>0&&found.length<=512,'class count cap');return found.sort((a,b)=>a.name.localeCompare(b.name));
}
try{
 for(const role of ['original','candidate']){
  const dir=path.join(inputs,role);fs.mkdirSync(dir);
  for(const s of config.sources){const relative=s.mainPath.split('/app/')[1],dest=path.join(dir,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});
   const b=role==='original'?readGit(['show',config.mainPin+':'+s.mainPath]):fs.readFileSync(path.join(sourceRoot,s.candidatePath));
   check(digest(b)===(role==='original'?s.sha256:s.candidateSha256),'role source mismatch');fs.writeFileSync(dest,b,{mode:0o400,flag:'wx'});
  }
  fs.writeFileSync(path.join(dir,'admission.json'),JSON.stringify({role,nonce,mainPin:config.mainPin,candidateHead,selectionDigest}),{mode:0o400,flag:'wx'});
 }
 fs.copyFileSync(path.join(bundle,'JvmLaneControl.java'),path.join(inputs,'JvmLaneControl.java'));
 fs.copyFileSync(helperPin.path,path.join(build,'landlock-runner.c'));
 fs.copyFileSync(path.join(bundle,'java-guard-runner.c'),path.join(build,'java-guard-runner.c'));
 fs.mkdirSync(path.join(build,'tmp'));fs.mkdirSync(path.join(build,'home'));
 const built=runFixed('/usr/bin/cc',['-B/usr/bin/','-O2','-std=gnu11','-Wall','-Wextra','-o',path.join(build,'java-guard-runner'),path.join(build,'java-guard-runner.c')],build,30000);
 fs.writeFileSync(path.join(build,'build-result.json'),JSON.stringify(built,null,2));check(!built.error&&built.status===0&&!built.leftoverGroup,'C launcher build failed');
 const launcherHash=hash(path.join(build,'java-guard-runner'));
 const capsulePins=()=>{
  const files=[path.join(inputs,'JvmLaneControl.java'),...['original','candidate'].flatMap(role=>[path.join(inputs,role,'admission.json'),...config.sources.map(s=>path.join(inputs,role,s.mainPath.split('/app/')[1]))])];
  return files.map(p=>({path:p,sha256:hash(p)}));
 };
 const initialCapsule=capsulePins();receipt.capsulePins=initialCapsule;receipt.launcherHash=launcherHash;save();
 function admission(){verifyProtected();check(hash(path.join(build,'java-guard-runner'))===launcherHash,'launcher changed');check(JSON.stringify(capsulePins())===JSON.stringify(initialCapsule),'capsule changed');}
 for(const role of ['original','candidate']){
  admission();const scratch=path.join(run,role);fs.mkdirSync(scratch);for(const p of ['classes','home','tmp'])fs.mkdirSync(path.join(scratch,p));
  const rr={role,scratch,compile:null,test:null,completed:false,correctness:false,controls:false};receipt.roles.push(rr);save();
  rr.compile=runFixed(path.join(build,'java-guard-runner'),[inputs,scratch,'compile',role],scratch);save();admission();
  check(!rr.compile.error&&rr.compile.status===0&&!rr.compile.leftoverGroup,'JVM compile failed; policy unchanged');
  const cLog=fs.readFileSync(path.join(scratch,'compile.log'),'utf8');check(cLog.includes('JVM C CONTROLS PASS: socket EPERM; fork EPERM; outside-write EACCES'),'missing compile C controls');
  const classesBefore=classPins(path.join(scratch,'classes'));rr.classPins=classesBefore;admission();
  rr.test=runFixed(path.join(build,'java-guard-runner'),[inputs,scratch,'run',role],scratch);save();admission();
  check(!rr.test.error&&!rr.test.leftoverGroup,'JVM test startup/timeout/incomplete failure');
  check(JSON.stringify(classPins(path.join(scratch,'classes')))===JSON.stringify(classesBefore),'classes changed during run');
  const tLog=fs.readFileSync(path.join(scratch,'test.log'),'utf8');check(tLog.includes('JVM C CONTROLS PASS: socket EPERM; fork EPERM; outside-write EACCES'),'missing test C controls');
  const body=JSON.parse(fs.readFileSync(path.join(scratch,'junit-result.json'),'utf8'));rr.observed=body;
  check([0,1].includes(rr.test.status),'unexpected JVM exit');
  check(body.schema==='daylight.fixed-jvm-role/v1'&&body.admission.role===role&&body.admission.nonce===nonce&&body.admission.selectionDigest===selectionDigest&&body.admission.mainPin===config.mainPin&&body.admission.candidateHead===candidateHead,'receipt linkage');
  const expected=[...config.expectedMethods].sort();const same=a=>Array.isArray(a)&&a.length===35&&new Set(a).size===35&&JSON.stringify([...a].sort())===JSON.stringify(expected);
  const net=body.network;
  const honestNet=net&&((net.networkInitializationDenied===true&&net.outboundConnectExercised===false&&net.connectionDenied===false)||(net.networkInitializationDenied===false&&net.outboundConnectExercised===true&&net.connectionDenied===true));
  rr.controls=body.controls===true&&body.networkMatcherControls===true&&body.processMatcherControls===true&&body.processStartDenied===true&&honestNet&&body.negativeAssertionObserved===true&&body.negativeSkipObserved===true;rr.completed=body.completed===true&&body.runCount===35&&same(body.started)&&same(body.finished)&&body.ignored.length===0&&body.assumptions.length===0&&body.ignoreCount===0;
  rr.correctness=rr.completed&&rr.controls&&body.correctness===true&&body.failureCount===0&&body.failures.length===0&&rr.test.status===0;
  check(rr.controls&&rr.completed,'controls/completeness failed');save();
  // Real baseline failures are retained as correctness=false; candidate runs the same assertions.
 }
 admission();receipt.protectedInputsUnchanged=true;receipt.controls=receipt.roles.length===2&&receipt.roles.every(r=>r.controls);receipt.completed=receipt.roles.length===2&&receipt.roles.every(r=>r.completed);receipt.correctness=receipt.completed&&receipt.controls&&receipt.roles.every(r=>r.correctness);receipt.incomplete=!receipt.completed;save();
 process.exitCode=receipt.correctness?0:1;
}catch(e){receipt.error=String(e.stack||e);receipt.incomplete=true;try{verifyProtected();
 if(receipt.launcherHash)check(hash(path.join(build,'java-guard-runner'))===receipt.launcherHash,'launcher changed');
 if(receipt.capsulePins)for(const p of receipt.capsulePins)check(hash(p.path)===p.sha256,'capsule changed');
 for(const r of receipt.roles)if(r.classPins)check(JSON.stringify(classPins(path.join(r.scratch,'classes')))===JSON.stringify(r.classPins),'classes changed');
 receipt.protectedInputsUnchanged=true;}catch(pinError){receipt.integrityError=String(pinError);}save();process.exitCode=1;}
console.log(JSON.stringify({receipt:path.join(run,'receipt.json'),completed:receipt.completed,correctness:receipt.correctness,incomplete:receipt.incomplete}));
