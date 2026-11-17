import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import yaml from 'js-yaml';
import axios from 'axios';
import {JevAdapter} from '#adapters/ai/JevAdapter.mjs';
import {createAiUsageLedger} from '#adapters/ai/AiUsageLedger.mjs';
import {NodeAsyncScheduler} from '#adapters/scheduling/NodeAsyncScheduler.mjs';
import {GratitudeJudge} from '../server/application/gratitude/GratitudeJudge.mjs';

export async function calibrateGratitude({judge,cases}){
  const results=[];
  for(let start=0;start<cases.length;start+=3){
    results.push(...await Promise.all(cases.slice(start,start+3).map(async item=>({id:item.id,expected:item.expected,...await judge.assess({text:item.text,history:item.history??[],allowFollowUp:item.allowFollowUp===true})}))));
  }
  const penalties=new Set(['nonsense','repetition']);
  const falsePenalties=results.filter(r=>!penalties.has(r.expected)&&penalties.has(r.verdict)).length;
  const correct=results.filter(r=>r.verdict===r.expected).length;
  return {passed:correct===results.length&&falsePenalties===0,total:results.length,correct,falsePenalties,results};
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{base:{type:'string'},fixtures:{type:'string'},out:{type:'string'},model:{type:'string'}}});
  const base=values.base??process.env.DAYLIGHT_BASE_PATH;
  if(!base||!values.out)throw new Error('Usage: gratitude-calibrate --base <content-base> --out <private-report.json> [--fixtures <file>] [--model <id>]');
  const auth=yaml.load(fs.readFileSync(path.join(base,'data/system/auth/jev.yml'),'utf8'));
  const logger={warn:event=>process.stderr.write(JSON.stringify({event})+'\n'),info(){},error:event=>process.stderr.write(JSON.stringify({event})+'\n')};
  const aiUsageLedger=createAiUsageLedger({dir:path.join(base,'data/system/history/ai-usage'),source:'gratitude-calibration',logger});
  const gateway=new JevAdapter({apiKey:auth.api_key,...(values.model?{model:values.model}:{})},{httpClient:axios,logger,aiUsageLedger}).scoped({app:'school',feature:'gratitude'});
  const judge=new GratitudeJudge({decisionGateway:gateway,scheduler:new NodeAsyncScheduler(),logger});
  const fixturePath=values.fixtures??fileURLToPath(new URL('./fixtures/gratitude-calibration.json',import.meta.url));
  const report=await calibrateGratitude({judge,cases:JSON.parse(fs.readFileSync(fixturePath,'utf8'))});
  fs.mkdirSync(path.dirname(values.out),{recursive:true});fs.writeFileSync(values.out,JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({passed:report.passed,total:report.total,correct:report.correct,falsePenalties:report.falsePenalties,report:values.out})+'\n');
  if(!report.passed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
