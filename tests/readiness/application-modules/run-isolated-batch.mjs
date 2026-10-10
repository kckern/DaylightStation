// Private reviewed index adapter; run-isolated-pair remains the HTTP admission authority.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectPairInputs} from './run-isolated-pair.mjs';
import {isDerivedOwner,admitDerivedPipeline,derivePair} from './derived-pipelines.mjs';
import {validateCaptureManifest} from './api-comparator.mjs';
import {validateSelection} from './run-readonly-suite.mjs';
import {validateStudyWindow} from './synthetic-study-grant.mjs';
import {validateRawFixtures,validateDirectoryFixtures} from './raw-utf8-fixture.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
// Two bounded role captures plus repeated full protected-input inventories need
// headroom beyond the observed 187.563s successful pair. Inner limits stay fixed.
export const COORDINATOR_TIMEOUT_MS=600000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonHash=value=>sha(JSON.stringify(value));
const hash=file=>sha(fs.readFileSync(file));
function read(file){assert.ok(fs.statSync(file).size<=16*1024*1024,'Oversized artifact');return JSON.parse(fs.readFileSync(file,'utf8'));}
function pin(binding){assert.ok(binding&&path.isAbsolute(binding.path),'Missing current pinned binding');assert.equal(fs.realpathSync(binding.path),binding.path,'Canonical artifact required');assert.match(binding.sha256,/^[a-f0-9]{64}$/);assert.equal(hash(binding.path),binding.sha256,'Artifact pin drift');return read(binding.path);}
function validateGroupValue(value){assert.ok(typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}(?:,[a-zA-Z0-9][a-zA-Z0-9._-]{0,150})*$/.test(value),'Nonempty group value required');}
function exact(a,b,label){assert.equal(new Set(a).size,a.length,'Duplicate '+label);assert.deepEqual([...a].sort(),[...b].sort(),label);}
function backing(rows){for(const row of rows??[]){if(row.absent){assert.ok(!fs.existsSync(row.path),'Backing absence drift');continue;}assert.equal(fs.realpathSync(row.path),row.path);const stat=fs.statSync(row.path);assert.equal(stat.dev,row.dev);assert.equal(stat.ino,row.ino);if(row.kind==='directory')assert.deepEqual(fs.readdirSync(row.path).sort(),row.entries);else if(row.kind==='directory-identity')assert.ok(stat.isDirectory());else assert.equal(hash(row.path),row.sha256,'Backing byte drift');}}
// Linux ownership is tracked by PID plus kernel start time, including descendants
// that GNU timeout moves into another process group. No global process-name kills.
function processRows(){
 const rows=new Map();for(const name of fs.readdirSync('/proc')){if(!/^\d+$/.test(name))continue;try{const stat=fs.readFileSync('/proc/'+name+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(') ')+2).split(' ');rows.set(Number(name),{pid:Number(name),state:fields[0],parent:Number(fields[1]),group:Number(fields[2]),session:Number(fields[3]),start:fields[19]});}catch{}}
 return rows;
}
const alive=row=>row&&!['Z','X'].includes(row.state);
export async function runOwnedProcess(command,args,log,{timeoutMs=COORDINATOR_TIMEOUT_MS,maxLogBytes=1024*1024}={}){
 assert.equal(process.platform,'linux','Owned descendant cancellation requires Linux /proc');
 const fd=fs.openSync(log,'wx',0o600),owned=new Map();let bytes=0,cancelled=null,error,closed=false,code,signal,cleanupTimer,forcedPipeClose=false;
 const child=spawn(command,args,{shell:false,detached:true,stdio:['ignore','pipe','pipe']});
 const discover=()=>{const rows=processRows();const root=rows.get(child.pid);if(root&&!closed&&!owned.has(root.pid))owned.set(root.pid,root);let added=true;while(added){added=false;for(const row of rows.values()){if(owned.has(row.pid))continue;const parent=owned.get(row.parent),current=rows.get(row.parent),leader=owned.get(child.pid);if((parent&&current?.start===parent.start)||(leader&&row.session===leader.session&&row.session===child.pid)){owned.set(row.pid,row);added=true;}}}return rows;};
 const send=(row,kind)=>{const current=processRows().get(row.pid);if(alive(current)&&current.start===row.start&&current.session===row.session){try{process.kill(row.pid,kind);}catch(e){if(e.code!=='ESRCH')error=e.message;}}};
 const cancel=reason=>{if(cancelled)return;cancelled=reason;cleanupTimer=setTimeout(()=>{forcedPipeClose=true;child.stdout.destroy();child.stderr.destroy();},5000);for(let pass=0;pass<3;pass++){discover();for(const row of owned.values())send(row,'SIGSTOP');}for(const row of [...owned.values()].reverse())send(row,'SIGKILL');};
 const onInterrupt=()=>cancel('SIGINT'),onTerminate=()=>cancel('SIGTERM');process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);
 const monitor=setInterval(()=>{discover();if(cancelled)for(const row of owned.values())send(row,'SIGKILL');},25);
 const timer=setTimeout(()=>cancel('timeout'),timeoutMs);
 const capture=chunk=>{const room=Math.max(0,maxLogBytes-bytes);if(room)fs.writeSync(fd,chunk.subarray(0,room));bytes+=chunk.length;if(bytes>maxLogBytes)cancel('log-overflow');};child.stdout.on('data',capture);child.stderr.on('data',capture);
 await new Promise(resolve=>{child.on('error',e=>{error=e.message;});child.on('close',(c,s)=>{closed=true;code=c;signal=s;resolve();});});
 clearTimeout(timer);discover();const survivors=()=>{const rows=processRows();return [...owned.values()].filter(row=>{const now=rows.get(row.pid);return alive(now)&&now.start===row.start&&now.session===row.session;});};
 if(survivors().length)cancel(cancelled??'owned-descendants-after-coordinator-exit');
 const deadline=Date.now()+5000;while(survivors().length&&Date.now()<deadline){for(const row of survivors())send(row,'SIGKILL');await new Promise(resolve=>setTimeout(resolve,25));}
 const cleanupAccepted=closed&&!forcedPipeClose&&survivors().length===0;clearTimeout(cleanupTimer);clearInterval(monitor);process.off('SIGINT',onInterrupt);process.off('SIGTERM',onTerminate);fs.closeSync(fd);
 return {code,signal,error,cancelled,overflow:cancelled==='log-overflow',cleanupAccepted};
}
// Unit controls may inject this boundary; CLI always invokes this exact coordinator.
const execute=(args,log,options)=>runOwnedProcess(process.execPath,[path.join(directory,'run-isolated-pair.mjs'),...args],log,options);
function unsupportedCases(row,manifest){
 if(row.currentPipeline){admitDerivedPipeline(row);return [];}
 const reasons=[];for(const c of manifest?.cases??[]){if(!row.healthyCaseIds.includes(c.id))continue;for(const key of ['initializationEpochContract','generatedTraceHeaderContract','generatedReportTraceContract'])if(c[key]!==undefined)reasons.push({id:c.id,reason:key+' has no current coordinator pipeline'});if(c.elapsedUptimeContract!==undefined&&c.id!=='fitness-native-led-metrics')reasons.push({id:c.id,reason:'elapsedUptimeContract supports only fitness-native-led-metrics'});}
 const nativeIds={'local-generated-school4-fitness-stored2':['school-generated-shelf-user_1','school-generated-shelf-user_2','school-generated-session-family','school-generated-session-headset'],'local-status-model6-partial5-reviewed-native-clocks':['remaining-ping','models-configured-metadata']}[row.name]??[];for(const id of row.healthyCaseIds.filter(id=>nativeIds.includes(id)))reasons.push({id,reason:'Reviewed historical native-clock/generated-ID derivation has no current coordinator pipeline'});
 return reasons;
}
export async function runBatch(options,{collectInputs=collectPairInputs,execute:runChild=execute}={}){
 const report={schema:'daylight.isolated-api-batch/v1',readinessAccepted:false,fullSuiteAccepted:false,healthySuiteAccepted:false,scope:Object.hasOwn(options,'group')?'partial':'full',mode:options.check?'check':'execute',indexSha256:options.indexSha256,errors:[],pending:[],groups:[],cases:[],diagnostics:[],records:[],spawnedGroups:0};
 let index,admitted=[];
 try{
  if(Object.hasOwn(options,'group'))validateGroupValue(options.group);
  assert.ok(path.isAbsolute(options.index??''),'Absolute index required');assert.match(options.indexSha256??'',/^[a-f0-9]{64}$/);assert.equal(hash(options.index),options.indexSha256,'Index pin drift');index=read(options.index);assert.equal(index.schema,'daylight.private-fullsuite-replay-index/v1');
  const pop=index.population;exact(pop.healthyTargetIds,Object.keys(index.healthyOwnership),'Healthy ownership population');assert.equal(pop.healthyTargetIds.length,pop.expectedHealthyCount);assert.equal(pop.contractGapIds.length,pop.expectedContractGapCount);assert.ok(pop.healthyTargetIds.length>0);
  const zeroCredit=index.zeroCreditDiagnostics??[];
  exact(zeroCredit.map(d=>d.id),[...new Set(zeroCredit.map(d=>d.id))],'Zero-credit diagnostic IDs');
  for(const d of zeroCredit){assert.equal(d.acceptedCredit,0);assert.equal(d.independentContractAccepted,false);assert.ok(!pop.healthyTargetIds.includes(d.id),'Healthy diagnostic overlap');}
  const diagnosticIds=[...new Set([...pop.contractGapIds,...pop.baselineFailureIds,...zeroCredit.map(d=>d.id)])];exact(diagnosticIds,[...new Set(diagnosticIds)],'Diagnostic IDs');assert.ok(diagnosticIds.every(id=>!pop.healthyTargetIds.includes(id)),'Healthy diagnostic overlap');
  const owned=[];const names=[];
  for(const row of index.records){assert.match(row.name,/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/);names.push(row.name);for(const id of row.healthyCaseIds){assert.equal(index.healthyOwnership[id],row.name,'Case ownership');owned.push(id);}}
  exact(names,[...new Set(names)],'Group names');exact(owned,pop.healthyTargetIds,'Exact healthy union');
  report.cases=pop.healthyTargetIds.map(id=>({id,owner:index.healthyOwnership[id],disposition:'pending'}));
  report.diagnostics=diagnosticIds.map(id=>({id,disposition:pop.contractGapIds.includes(id)?'contract-gap':'baseline-failure',credit:0,bindings:index.records.filter(r=>(r.contractGapCaseIds??[]).includes(id)||(r.excludedIdDispositions??[]).some(d=>d.id===id)).map(r=>r.name)}));for(const d of report.diagnostics){const detail=zeroCredit.find(x=>x.id===d.id);if(detail){assert.ok(names.includes(detail.owner),'Diagnostic owner');d.disposition=detail.disposition;d.owner=detail.owner;d.requiredDiagnosis=detail.requiredDiagnosis;d.baselineFunctionalFailureConfirmed=detail.baselineFunctionalFailureConfirmed;d.bindings=[detail.owner];}}assert.ok(report.diagnostics.every(d=>d.bindings.length),'Missing diagnostic disposition');
  const selectedGroups=options.group?options.group.split(','):names;exact(selectedGroups,[...new Set(selectedGroups)],'Selected group names');assert.ok(selectedGroups.every(name=>names.includes(name)),'Unknown group');report.selectedGroups=selectedGroups;const required=new Set(selectedGroups);
  for(const row of index.records){report.records.push({name:row.name,disposition:row.healthyCaseIds.length?'pending':'evidence-only-skipped',credit:0});if(!row.healthyCaseIds.length)continue;if(!required.has(row.name)){report.pending.push({name:row.name,required:false,reason:'Outside selected scope; current admission not checked',dependencies:row.dependencies??[]});continue;}const missing=[];if(isDerivedOwner(row.name)&&!row.currentPipeline)missing.push('currentPipeline');if(row.runnable!==true)missing.push('runnable');if(!row.currentFixture)missing.push('currentFixture');if(!row.currentPairProof)missing.push('currentPairProof');if(!row.executionManifest)missing.push('executionManifest');const unsupported=[...unsupportedCases(row,row.executionManifest?pin(row.executionManifest):null),...unsupportedCases(row,row.selectedManifest?pin(row.selectedManifest):null)];if(unsupported.length)report.pending.push({name:row.name,required:true,unsupportedCaseIds:[...new Set(unsupported.map(c=>c.id))],reasons:unsupported});if(missing.length)report.pending.push({name:row.name,required:true,missing,dependencies:row.dependencies??[]});}
  if(!index.execution)report.pending.push({name:'execution',missing:['explicit originalRoot/candidateRoot/toolRoot and originalCommit/candidateCommit']});
  if(report.pending.some(p=>p.required!==false))return report;
  const roots=index.execution;for(const key of ['originalRoot','candidateRoot','toolRoot']){assert.ok(path.isAbsolute(roots[key]??''),'Explicit root required');assert.equal(fs.realpathSync(roots[key]),roots[key]);}
  assert.equal(roots.originalCommit,index.sourceOriginal);assert.equal(roots.candidateCommit,index.sourceCandidate);
  const inputs=collectInputs(roots);assert.equal(inputs.original.sourceCommit,roots.originalCommit,'Original commit pin');assert.equal(inputs.candidate.sourceCommit,roots.candidateCommit,'Candidate commit pin');
  for(const row of index.records.filter(r=>r.healthyCaseIds.length&&required.has(r.name))){const fixture=pin(row.currentFixture),manifest=pin(row.executionManifest),proof=pin(row.currentPairProof);assert.equal(proof.schema,'daylight.isolated-api-pair-proof/v1');assert.equal(proof.reviewed,true);assert.equal(proof.fixtureFileSha256,row.currentFixture.sha256);assert.equal(proof.manifestFileSha256,row.executionManifest.sha256);for(const key of ['original','candidate','runtime','harness'])assert.equal(jsonHash(inputs[key]),proof[key+'Sha256'],key+' inventory admission');validateCaptureManifest(manifest,proof.fixtureFileSha256);validateStudyWindow(manifest,Date.now(),true);validateSelection(manifest,proof.cases,{isolatedStudyFixtureFileSha256:proof.fixtureFileSha256});validateRawFixtures(fixture);validateDirectoryFixtures(fixture);backing(proof.backingInputs);if(row.currentPipeline)admitDerivedPipeline(row,roots);exact(manifest.cases.map(c=>c.id),row.healthyCaseIds,'Selected healthy IDs');assert.ok(proof.cases.every(c=>c.independentContractAccepted===true),'Healthy independent contracts required');admitted.push({row,proof});}
  report.admissionAccepted=true;if(options.check)return report;
  assert.ok(path.isAbsolute(options.outputRoot??''),'Absolute new output required');assert.ok(!fs.existsSync(options.outputRoot),'New output required');for(const key of ['originalRoot','candidateRoot','toolRoot'])assert.ok(options.outputRoot!==roots[key]&&!options.outputRoot.startsWith(roots[key]+path.sep),'Output outside source/tools');assert.equal(fs.realpathSync(path.dirname(options.outputRoot)),path.dirname(options.outputRoot),'Canonical output parent');fs.mkdirSync(options.outputRoot,{mode:0o700});
  for(const {row} of admitted){
   assert.equal(hash(options.index),options.indexSha256,'Index drift');pin(row.currentFixture);pin(row.executionManifest);pin(row.currentPairProof);if(row.currentPipeline)admitDerivedPipeline(row,roots);
   const out=path.join(options.outputRoot,row.name);fs.mkdirSync(out,{mode:0o700});const args=['--original-root',roots.originalRoot,'--candidate-root',roots.candidateRoot,'--tool-root',roots.toolRoot,'--output-root',out,'--fixture',row.currentFixture.path,'--manifest',row.executionManifest.path,'--proof',row.currentPairProof.path];report.spawnedGroups++;
   const child=await runChild(args,path.join(options.outputRoot,row.name+'.log'),{timeoutMs:COORDINATOR_TIMEOUT_MS});const entry={name:row.name,child,output:out};report.groups.push(entry);
   const record=report.records.find(r=>r.name===row.name);record.disposition='executed';const rows=report.cases.filter(c=>c.owner===row.name);
   if(child.signal||child.error||child.overflow||child.cancelled||child.cleanupAccepted===false){for(const c of rows)c.disposition='blocked';record.disposition='blocked';report.errors.push('Coordinator cancellation/cleanup failure: '+row.name);break;}
   const result=read(path.join(out,'pair-result.json'));assert.equal(result.schema,'daylight.isolated-api-pair/v1');entry.result=result;
   if(result.executionAccepted!==true||result.guardsAccepted!==true){for(const c of rows)c.disposition='blocked';report.errors.push('Coordinator safety/admission failure: '+row.name);break;}
   assert.ok(child.code===0||child.code===1,'Coordinator exit failure');assert.equal(result.comparison,path.join(out,'comparison.json'),'Contained comparison required');let comparison=read(result.comparison);exact(comparison.cases.map(c=>c.id),row.healthyCaseIds,'Complete comparison IDs');assert.equal(result.equivalenceAccepted,comparison.cases.every(c=>c.accepted===true),'Coordinator comparison consistency');
   assert.equal(child.code===0,result.equivalenceAccepted===true,'Coordinator exit/result consistency');
   if(row.currentPipeline){const derived=await derivePair({row,result,roots,output:path.join(out,'derived')});entry.derived=derived.receipt;comparison=derived.comparison;exact(comparison.cases.map(c=>c.id),row.healthyCaseIds,'Complete derived IDs');}
   for(const c of rows){const observed=comparison.cases.find(x=>x.id===c.id);c.disposition=observed.accepted===true?'passed':'failed';c.errors=observed.errors??[];}
  }
  report.healthySuiteAccepted=report.scope==='full'&&report.errors.length===0&&report.cases.every(c=>c.disposition==='passed');
  report.fullSuiteAccepted=report.healthySuiteAccepted&&report.diagnostics.length===0;
 }catch(error){report.errors.push(error.message);report.fullSuiteAccepted=false;}
 return report;
}
export async function main(argv=process.argv.slice(2)){
 const options={};for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--check'){assert.ok(!options.check);options.check=true;continue;}const mapped={'--index':'index','--index-sha256':'indexSha256','--output-root':'outputRoot','--group':'group'}[key];assert.ok(mapped&&!Object.hasOwn(options,mapped),'Unknown/duplicate batch option');options[mapped]=argv[++i];if(mapped==='group')validateGroupValue(options[mapped]);}
 const report=await runBatch(options);if(!options.check&&options.outputRoot&&fs.existsSync(options.outputRoot)&&report.spawnedGroups>0)fs.writeFileSync(path.join(options.outputRoot,'batch-result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify(report)+'\n');return options.check?report.admissionAccepted===true?0:1:report.fullSuiteAccepted?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.exitCode=await main();
