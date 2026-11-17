import path from 'node:path';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import { createWorkRuntime } from '../server/runtime.mjs';
import { createKnowledgeImportRuntime, createJournalKnowledgeSource } from '../../lifelog/server/knowledge-runtime.mjs';
const HELP = `work — inspect configured tasks or run a quiet bounded journal import
  inspect --username USER
  backfill prepare --username USER --days 90 --as-of ISO --output-dir PRIVATE
  backfill preview --manifest FILE --usage-dir OUTSIDE_DATA
  backfill apply --manifest FILE --artifact FILE
The range is at most 90 elapsed days. Preview uses shared persistent four-attempt
daily receipts outside data; keep the same usage directory when resuming.
Apply requires configured import writes and the actual writer host/env/UID.
Imports remain quiet until explicitly activated. No provider mutation or send.
Incomplete coverage is reported; incomplete extraction cannot apply.
`;
function parse(argv) {
  if (!argv.length || ['--help', '-h', 'help'].includes(argv[0])) return {
    command: 'help',
    options: {}
  };
  let command = argv[0],
    index = 1;
  if (command === 'backfill') {
    command = 'backfill ' + argv[1];
    index = 2;
  }
  const flags = {
    'inspect': ['--username'],
    'backfill prepare': ['--username', '--days', '--as-of', '--output-dir'],
    'backfill preview': ['--manifest', '--usage-dir'],
    'backfill apply': ['--manifest', '--artifact']
  }[command];
  if (!flags) throw new Error('Unknown work command');
  const options = {};
  for (; index < argv.length; index += 2) {
    const key = argv[index],
      value = argv[index + 1];
    if (!flags.includes(key) || Object.hasOwn(options, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('Invalid work option');
    options[key] = value;
  }
  if (flags.some(key => !Object.hasOwn(options, key))) throw new Error('Missing required work option');
  if (options['--username'] && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options['--username'])) throw new Error('Invalid username');
  if (command === 'backfill prepare') {
    const value = options['--as-of'];
    if (!/^[1-9][0-9]?$/.test(options['--days']) || Number(options['--days']) > 90 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid bounded import range');
  }
  return {
    command,
    options
  };
}
export async function runWorkCli({
  argv,
  runtime,
  clock = Date.now,
  stdout = process.stdout
}) {
  const {
    command,
    options
  } = parse(argv);
  if (command === 'help') {
    stdout.write(HELP);
    return 0;
  }
  let result;
  if (command === 'inspect') {
    if (!runtime?.context) throw new Error('Work is disabled');
    result = await runtime.context.execute({
      username: options['--username'],
      asOf: clock()
    });
  } else {
    if (!runtime?.backfill) throw new Error('Work backfill is unavailable');
    if (command === 'backfill prepare') result = await runtime.backfill.prepare({
      username: options['--username'],
      days: Number(options['--days']),
      asOf: Date.parse(options['--as-of']),
      outputDir: options['--output-dir']
    });
    if (command === 'backfill preview') result = await runtime.backfill.preview({
      manifestPath: options['--manifest'],
      usageDir: options['--usage-dir']
    });
    if (command === 'backfill apply') result = await runtime.backfill.apply({
      manifestPath: options['--manifest'],
      artifactPath: options['--artifact']
    });
  }
  stdout.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
}
async function defaultDependencies({
  options
}) {
  const [{
    getConfigService
  }, {
    createLogger
  }, {
    UserIdentityService
  }, {
    TelegramIdentityAdapter
  }, {
    OpenAIAdapter
  }, {
    HttpClient
  }, {
    createAiUsageLedger
  }] = await Promise.all([import('../../../../cli/_bootstrap.mjs'), import('#system/logging/logger.mjs'), import('#domains/messaging/services/UserIdentityService.mjs'), import('#adapters/messaging/TelegramIdentityAdapter.mjs'), import('#adapters/ai/OpenAIAdapter.mjs'), import('#system/services/HttpClient.mjs'), import('#adapters/ai/AiUsageLedger.mjs')]);
  const config = await getConfigService(),
    diagnostic = createLogger({
      source: 'cli',
      app: 'work',
      context: {
        module: 'backfill'
      }
    }),
    logger = {
      ...diagnostic,
      info() {},
      debug() {}
    };
  const identityService = new UserIdentityService(config.getIdentityMappings());
  const botConfigs = Object.fromEntries(Object.entries(config.getSystemConfig('bots') ?? {}).filter(([, bot]) => bot?.telegram?.bot_id).map(([name, bot]) => [name, {
    botId: bot.telegram.bot_id
  }]));
  const identities = new TelegramIdentityAdapter({
    userIdentityService: identityService,
    botConfigs,
    logger
  });
  const timezone = username => config.getUserProfile(username)?.timezone ?? config.getHouseholdTimezone(config.getUserHouseholdId(username));
  const read = (username, relative) => {
    try {
      return yaml.load(FileIO.readTextFromPath(path.join(config.getUserDir(username), relative + '.yml')), {
        schema: yaml.JSON_SCHEMA
      });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  const identityForUser = username => ({
    senderId: identityService.resolvePlatformId('telegram', username),
    conversationId: identities.resolve('journalist', {
      username
    }).conversationIdString
  });
  const loadJournal = createJournalKnowledgeSource({
    userDirForUser: username => config.getUserDir(username)
  });
  const runtime = createWorkRuntime({
    configuration: () => config.getHouseholdAppConfig(null, 'work') ?? {},
    dataDir: config.getDataDir(),
    rootForUser: username => path.join(config.getUserDir(username), 'work'),
    userTimezone: timezone,
    readCurrent: (u, p) => read(u, 'current/' + p),
    readHealth: (u, p) => read(u, 'current/' + p + '-health'),
    readHistory: (u, p) => read(u, 'lifelog/' + p),
    logger,
    knowledgeBridge: {
      openJob: async ({
        policy,
        checkpoint,
        workContext,
        verifyPolicy
      }) => {
        const model = config.getHouseholdAppConfig(config.getUserHouseholdId(policy.username), 'lifelog')?.knowledge?.model;
        const kb = createKnowledgeImportRuntime({
          configuration: {
            enabled: policy.enabled,
            write: policy.writer.write,
            importWrites: policy.importWrites,
            writer_env: policy.writer.writer_env,
            writer_host: policy.writer.writer_host,
            operator_uid: policy.writer.operatorUid,
            modelCallsPerLocalDay: policy.limits.modelCallsPerLocalDay,
            ...(model ? {
              model
            } : {})
          },
          dataDir: config.getDataDir(),
          rootForUser: username => path.join(config.getUserDir(username), 'lifelog/knowledge'),
          checkpoint,
          workContext,
          verifyPolicy,
          userTimezone: timezone,
          identityForUser,
          loadJournal,
          logger,
          gatewayFactory: async () => {
            const apiKey = config.getSystemAuth('openai', 'api_key');
            if (!apiKey) throw new Error('No configured AI credentials');
            const usageDir = FileIO.resolveRealPath(options['--usage-dir']);
            if (!usageDir) throw new Error('Missing private usage directory');
            return new OpenAIAdapter({
              apiKey,
              ...(model ? {
                model
              } : {})
            }, {
              httpClient: new HttpClient({
                logger
              }),
              logger,
              aiUsageLedger: createAiUsageLedger({
                dir: usageDir,
                source: 'cli',
                logger
              })
            });
          }
        });
        return {
          bridge: kb.bridge,
          dispose: () => kb.dispose()
        };
      }
    }
  });
  return {
    runtime
  };
}
export async function main(argv = process.argv.slice(2), {
  dependenciesFactory = defaultDependencies,
  stdout = process.stdout
} = {}) {
  const parsed = parse(argv);
  if (parsed.command === 'help') {
    stdout.write(HELP);
    return 0;
  }
  const dependencies = await dependenciesFactory(parsed);
  try {
    return await runWorkCli({
      argv,
      ...dependencies,
      stdout
    });
  } finally {
    await dependencies.runtime?.dispose();
  }
}
