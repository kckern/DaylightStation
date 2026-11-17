#!/usr/bin/env node
import path from 'node:path';
import moment from 'moment-timezone';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import {previewKnowledge,createJournalEvidencePreview} from '../../lifelog/server/knowledge-runtime.mjs';
import {GenerateMorningDebrief} from '../server/application/usecases/GenerateMorningDebrief.mjs';
import {DebriefRepository} from '../server/adapters/DebriefRepository.mjs';
const HELP='journalist-knowledge-preview --username USER --input EXTRACTION_JSON --requests REQUESTS_JSON\nRead-only cached-facts rendering; zero model calls, writes or sends. Requests contain explicit reportDate, askDate and ISO asOf.\n';
const quiet={info(){},warn(){},error(){}};
const instant=value=>{if(typeof value!=='string'||!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Preview requires an explicit ISO asOf');return Date.parse(value);};
export async function runJournalistKnowledgePreview({username,timezone,extraction,requests,readMessages,debriefRepository,logger=quiet}){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(username)||!moment.tz.zone(timezone)||extraction?.schema!=='lifelog-knowledge-preview/v1'||extraction.dryRun!==true||extraction.username!==username||!Array.isArray(extraction.proposals))throw new Error('Invalid read-only extraction artifact');
 if(!Array.isArray(requests)||requests.length<1||requests.length>10)throw new Error('Supply one to ten explicit preview requests');
 const since=moment.tz(extraction.since,'YYYY-MM-DD',true,timezone),until=moment.tz(extraction.until,'YYYY-MM-DD',true,timezone);
 if(!since.isValid()||!until.isValid()||until.isBefore(since)||!Number.isFinite(extraction.asOf))throw new Error('Invalid extraction date bounds');
 const ordered=[...requests].sort((a,b)=>String(a.reportDate).localeCompare(String(b.reportDate))),dates=new Set();
 for(const request of ordered){
  const report=moment.tz(request.reportDate,'YYYY-MM-DD',true,timezone),asOf=instant(request.asOf);
  if(!report.isValid()||dates.has(request.reportDate)||request.reportDate<extraction.since||request.reportDate>extraction.until||report.clone().add(1,'day').format('YYYY-MM-DD')!==request.askDate||moment.tz(asOf,timezone).format('YYYY-MM-DD')!==request.askDate||asOf>extraction.asOf)throw new Error('Invalid report/ask/as-of relationship');
  dates.add(request.reportDate);
 }
 const rows=await readMessages({username,after:since.valueOf(),through:Math.min(until.clone().add(1,'day').valueOf(),extraction.asOf)});
 const refs=new Set(rows.messages.map(row=>row.ref));if(extraction.proposals.some(p=>!refs.has(p.evidenceRef)))throw new Error('Extraction evidence changed or is unavailable; rerun the gated preview');
 const previews=[];
 for(const request of ordered){
  const asOf=instant(request.asOf),view=previewKnowledge({username,proposals:extraction.proposals,evidence:rows.messages,askDate:request.askDate,activationDate:ordered[0].askDate,asOf,timezone});
  const cached=await debriefRepository.getDebriefByDate(request.reportDate,username),summaries=Array.isArray(cached?.summaries)?cached.summaries:[];
  const existing=cached?{...cached,summaries}:null;
  const generator=new GenerateMorningDebrief({clock:()=>asOf,userTimezone:()=>timezone,followUpSource:{selectForMorning:async()=>view.selection},debriefRepository:{getDebriefByDate:async()=>existing},lifelogAggregator:{aggregate:async()=>({_meta:{date:request.reportDate,hasEnoughData:!!existing,sources:summaries.map(row=>typeof row==='string'?row:row.source).filter(Boolean)},summaries,summaryText:summaries.map(row=>typeof row==='string'?row:row.text??'').join('\n')})},aiGateway:{chat:async()=>{throw new Error('Offline preview has no model gateway');}},logger});
  const result=await generator.execute({username,date:request.reportDate,askDate:request.askDate,asOf});
  const summary=result.summary??result.fallbackPrompt??'';
  previews.push({...request,mode:view.selection.mode,headline:result.headline??null,summary,questionCount:(summary.match(/[?？]/g)??[]).length,sourceSummaries:result.lifelog?.summaries??[],rejected:view.rejected,fallback:!result.success});
 }
 return {schema:'journalist-knowledge-render-preview/v1',dryRun:true,username,modelCalls:0,cachedFacts:true,previews};
}
async function dependencies(username){
 const [{getConfigService},{UserIdentityService},{TelegramIdentityAdapter},{createLogger}]=await Promise.all([import('../../../../cli/_bootstrap.mjs'),import('#domains/messaging/services/UserIdentityService.mjs'),import('#adapters/messaging/TelegramIdentityAdapter.mjs'),import('#system/logging/logger.mjs')]);
 const config=await getConfigService(),diagnostic=createLogger({source:'cli',app:'journalist',context:{module:'knowledge-preview'}}),logger={...diagnostic,info(){},debug(){}},identity=new UserIdentityService(config.getIdentityMappings());
 const bots=Object.fromEntries(Object.entries(config.getSystemConfig('bots')??{}).filter(([,bot])=>bot?.telegram?.bot_id).map(([name,bot])=>[name,{botId:bot.telegram.bot_id}]));
 const telegram=new TelegramIdentityAdapter({userIdentityService:identity,botConfigs:bots,logger});
 const timezone=config.getUserProfile(username)?.timezone??config.getHouseholdTimezone(config.getUserHouseholdId(username));
 const reader=createJournalEvidencePreview({loadJournal:async user=>{try{return yaml.load(FileIO.readTextFromPath(path.join(config.getUserDir(user),'lifelog/journalist/messages.yml')),{schema:yaml.JSON_SCHEMA});}catch(error){if(error.code==='ENOENT')return null;throw error;}},identityForUser:user=>({senderId:identity.resolvePlatformId('telegram',user),conversationId:telegram.resolve('journalist',{username:user}).conversationIdString}),timezoneForUser:()=>timezone,logger});
 return {timezone,logger,readMessages:reader.readMessages,debriefRepository:new DebriefRepository({dataDir:config.getDataDir(),username,userPathFor:user=>path.join(config.getUserDir(user),'lifelog/journalist'),logger})};
}
export async function main(argv=process.argv.slice(2)){
 if(argv.length===0||argv.length===1&&['--help','-h'].includes(argv[0])){process.stdout.write(HELP);return 0;}
 const options={};for(let i=0;i<argv.length;i+=2){if(!['--username','--input','--requests'].includes(argv[i])||Object.hasOwn(options,argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Unsupported or missing preview option');options[argv[i]]=argv[i+1];}
 if(!options['--username']||!options['--input']||!options['--requests']||!/^[A-Za-z0-9_-]{1,128}$/.test(options['--username']))throw new Error('All documented preview options are required');
 const result=await runJournalistKnowledgePreview({username:options['--username'],extraction:JSON.parse(FileIO.readTextFromPath(options['--input'])),requests:JSON.parse(FileIO.readTextFromPath(options['--requests'])),...await dependencies(options['--username'])});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
}
