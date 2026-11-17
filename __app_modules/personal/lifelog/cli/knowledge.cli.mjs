#!/usr/bin/env node
import {KnowledgeMetrics} from '../server/application/knowledge/KnowledgeMetrics.mjs';
/** Phase 0: local previews only. No writer, scheduler, delivery or activation door. */
import path from 'node:path';
import crypto from 'node:crypto';
import moment from 'moment-timezone';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import { createAiUsageLedger } from '#adapters/ai/AiUsageLedger.mjs';
import { reduceKnowledge } from '../server/domain/knowledge/reduceKnowledge.mjs';
import { selectQuestions } from '../server/domain/knowledge/selectQuestions.mjs';
import { assertUsername } from '../server/adapters/knowledge/knowledgeFiles.mjs';
const HELP = `knowledge — read-only Lifelog previews
  extract --dry-run --username USER --since DATE --until DATE --as-of ISO --usage-dir OUTSIDE_DATA
  show --username USER
  questions --username USER --ask-date DATE --as-of ISO
  metrics --username USER --since DATE --until DATE --as-of ISO
Usage directory must already exist outside the data tree. Keep the same receipts directory across previews; failed calls consume the daily four-call budget.
`;
function parse(argv) {
  const [command,...rest] = argv;
  if (!command || ['--help','-h','help'].includes(command)) return { command: 'help' };
  const allowed = { extract: ['--username','--since','--until','--as-of','--usage-dir','--dry-run'], show: ['--username'], metrics:['--username','--since','--until','--as-of'], questions: ['--username','--ask-date','--as-of'] }[command];
  if (!allowed) throw new Error('Unknown knowledge command; no write/apply/send mode exists');
  const options = {};
  for (let i=0; i<rest.length; i++) {
    const key = rest[i];
    if (!allowed.includes(key) || Object.hasOwn(options,key)) throw new Error('Unsupported or duplicate knowledge option');
    if (key === '--dry-run') options[key] = true;
    else {
      if (!rest[i+1] || rest[i+1].startsWith('--')) throw new Error(`Missing value for ${key}`);
      options[key] = rest[++i];
    }
  }
  if (allowed.some(key => !options[key])) throw new Error('Knowledge preview requires all documented options');
  assertUsername(options['--username']);
  return { command, options };
}
function timezoneFor(config, username) {
  const timezone = config.getUserTimezone?.(username) ?? config.getUserProfile?.(username)?.timezone
    ?? config.getHouseholdTimezone?.(config.getUserHouseholdId?.(username));
  if (!moment.tz.zone(timezone)) throw new Error('A configured user/household timezone is required');
  return timezone;
}
function explicitInstant(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error('as-of needs an ISO instant with timezone');
  const at = moment.parseZone(value, moment.ISO_8601, true).valueOf();
  if (!Number.isFinite(at)) throw new Error('Invalid as-of instant');
  return at;
}
function localDay(value, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected a local YYYY-MM-DD date');
  const day = moment.tz(value, 'YYYY-MM-DD', true, timezone);
  if (!day.isValid()) throw new Error('Invalid local date');
  return day;
}
function outsideUsageDirectory(value, dataDir) {
  const root = FileIO.resolveRealPath(dataDir), dir = FileIO.resolveRealPath(value);
  if (!root || !dir || !FileIO.getFileStats(dir).isDirectory()) throw new Error('Usage directory must already exist outside the data tree');
  const relative = path.relative(root,dir);
  if (!relative || relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)) throw new Error('Usage directory must be outside the data tree');
  return dir;
}
function reserveBudget({ dir, username, timezone, now }) {
  const user = crypto.createHash('sha256').update(username).digest('hex').slice(0,24);
  const date = moment.tz(now,timezone).format('YYYY-MM-DD');
  for (let slot=1; slot<=4; slot++) {
    try {
      FileIO.writeFileExclusive(path.join(dir,`knowledge-budget-${user}-${date}-${slot}.json`),JSON.stringify({schema:'knowledge-preview-budget/v1',at:now,date,slot})+'\n');
      return;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Knowledge preview daily budget exhausted');
}

export async function runKnowledgeCli({ argv, configService, store, evidence, extractorFactory,
  metrics, usageLedgerFactory = createAiUsageLedger, clock = () => Date.now(), logger, stdout = process.stdout }) {
  const { command, options } = parse(argv);
  if (command === 'help') { stdout.write(HELP); return 0; }
  const username = options['--username'];
  const timezone = timezoneFor(configService,username);
  const output = value => stdout.write(JSON.stringify(value,null,2)+'\n');
  if (command === 'show') { output(await store.read({username})); return 0; }
  const asOf = explicitInstant(options['--as-of']);
  if(command==='metrics'){
    if(!metrics?.report)throw new Error('Read-only metrics service unavailable');
    output(await metrics.report({username,from:localDay(options['--since'],timezone).valueOf(),to:localDay(options['--until'],timezone).add(1,'day').valueOf(),asOf}));
    return 0;
  }
  if (command === 'questions') {
    localDay(options['--ask-date'],timezone);
    output(selectQuestions({snapshot:await store.read({username}),askDate:options['--ask-date'],asOf,timezone,max:2}));
    return 0;
  }
  const usageDir = outsideUsageDirectory(options['--usage-dir'],configService.getDataDir());
  const since = localDay(options['--since'],timezone), until = localDay(options['--until'],timezone).add(1,'day');
  if (until.valueOf() <= since.valueOf() || asOf < since.valueOf()) throw new Error('Invalid preview date range');
  const selected = await evidence.readUserMessages({username,after:since.valueOf(),through:Math.min(until.valueOf()-1,asOf),preview:true});
  const snapshot = await store.read({username});
  if (!snapshot.health.available) throw new Error('Knowledge snapshot unavailable for preview');
  let extraction = {proposals:[],modelVersion:null};
  if (selected.messages.length) {
    reserveBudget({dir:usageDir,username,timezone,now:clock()});
    const usageLedger = usageLedgerFactory({dir:usageDir,source:'cli',logger});
    const extractor = await extractorFactory({usageLedger});
    extraction = await extractor.extract({messages:selected.messages,openLoops:Object.values(snapshot.objects),roster:snapshot.roster,
      askedLoops:snapshot.asks,timezone,asOf});
  }
  const result = reduceKnowledge({snapshot,proposals:extraction.proposals,evidence:selected.messages,asOf,timezone,mode:'preview'});
  output({schema:'lifelog-knowledge-preview/v1',dryRun:true,username,since:options['--since'],until:options['--until'],asOf,
    modelVersion:extraction.modelVersion,proposals:extraction.proposals,
    accepted:result.batch.events.filter(event=>event.type==='proposal.accepted').length,rejected:result.rejected,
    reviewNeeded:result.batch.events.filter(event=>event.type==='proposal.queued').length,evidenceRejected:selected.rejected??[],batch:result.batch});
  return 0;
}

async function defaultDependencies() {
  const [{getConfigService},{createLogger},{YamlKnowledgeStore},{JsonlKnowledgeLedger},{JournalKnowledgeEvidence},{GatewayKnowledgeExtractor},
    {UserIdentityService},{TelegramIdentityAdapter},{OpenAIAdapter},{HttpClient}] = await Promise.all([
    import('../../../../cli/_bootstrap.mjs'),import('#system/logging/logger.mjs'),
    import('../server/adapters/knowledge/YamlKnowledgeStore.mjs'),import('../server/adapters/knowledge/JsonlKnowledgeLedger.mjs'),
    import('../server/adapters/knowledge/JournalKnowledgeEvidence.mjs'),import('../server/adapters/knowledge/GatewayKnowledgeExtractor.mjs'),
    import('#domains/messaging/services/UserIdentityService.mjs'),import('#adapters/messaging/TelegramIdentityAdapter.mjs'),
    import('#adapters/ai/OpenAIAdapter.mjs'),import('#system/services/HttpClient.mjs'),
  ]);
  const configService = await getConfigService();
  const diagnostic=createLogger({source:'cli',app:'lifelog',context:{module:'knowledge-preview'}});
  const logger={...diagnostic,info(){},debug(){}}; // Keep stdout machine-readable; usage has its own durable ledger.
  const identityService = new UserIdentityService(configService.getIdentityMappings());
  const botConfigs = Object.fromEntries(Object.entries(configService.getSystemConfig('bots')??{}).filter(([,bot])=>bot?.telegram?.bot_id)
    .map(([name,bot])=>[name,{botId:bot.telegram.bot_id}]));
  const identities = new TelegramIdentityAdapter({userIdentityService:identityService,botConfigs,logger});
  const rootForUser = username => {assertUsername(username);return path.join(configService.getUserDir(username),'lifelog/knowledge');};
  const authority = {leaseLost:false,assertWriter:async()=>{throw new Error('Knowledge CLI is read-only');}};
  const ledger = new JsonlKnowledgeLedger({rootForUser,hostId:'readonly-cli',authority,logger});
  const store = new YamlKnowledgeStore({rootForUser,ledger,authority,clock:()=>Date.now(),logger});
  const evidence = new JournalKnowledgeEvidence({logger,
    loadJournal:async username=>{assertUsername(username);try{return yaml.load(FileIO.readTextFromPath(path.join(configService.getUserDir(username),'lifelog/journalist/messages.yml')),{schema:yaml.JSON_SCHEMA});}catch(error){if(error.code==='ENOENT')return null;throw error;}},
    identityForUser:async username=>({senderId:identityService.resolvePlatformId('telegram',username),conversationId:identities.resolve('journalist',{username}).conversationIdString}),
    timezoneForUser:username=>timezoneFor(configService,username),
  });
  return {configService,store,evidence,metrics:new KnowledgeMetrics({store,ledger}),logger,extractorFactory:async({usageLedger})=>{
    const apiKey = configService.getSystemAuth('openai','api_key');
    if (!apiKey) throw new Error('No configured AI gateway credentials');
    const configuredModel = configService.getHouseholdAppConfig(null,'lifelog')?.knowledge?.model;
    const gateway = new OpenAIAdapter({apiKey,...(configuredModel?{model:configuredModel}:{})},{httpClient:new HttpClient({logger}),logger,aiUsageLedger:usageLedger});
    return new GatewayKnowledgeExtractor({gateway,modelVersion:gateway.model});
  }};
}
export async function main(argv = process.argv.slice(2)) {
  if (parse(argv).command === 'help') { process.stdout.write(HELP); return 0; }
  return runKnowledgeCli({argv,...await defaultDependencies()});
}
