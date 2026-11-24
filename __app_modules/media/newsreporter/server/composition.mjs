import { ReportReceiptRenderer } from "./rendering/ReportReceiptRenderer.mjs";
import { NewspaperRenderer } from "./rendering/NewspaperRenderer.mjs";
import { createSourceRegistry as createNewsSourceRegistry } from "./adapters/sources/sourceRegistry.mjs";
import { NewsReporterJobDatastore } from "./adapters/NewsReporterJobDatastore.mjs";
import { YamlReportRunDatastore } from "./adapters/persistence/YamlReportRunDatastore.mjs";
import { YamlEditionDatastore } from "./adapters/persistence/YamlEditionDatastore.mjs";
import { NewsReporterContainer } from "./application/NewsReporterContainer.mjs";
import { NewsReporterConfigProjection } from "./adapters/NewsReporterConfigProjection.mjs";
import { NodeApplicationScheduler } from "#adapters/scheduling/NodeApplicationScheduler.mjs";

/**
 * Compose the newsreporter: the `report` kind (sources → consolidate → sinks)
 * and the `edition` kind (the office paper).
 *
 * Edition inputs, all optional (a missing one drops what depends on it):
 *   aiGateway        IAIGateway scoped { app: 'newsreporter', feature: 'office-paper' } (write; chat pick fallback)
 *   decisionGateway  IDecisionGateway, scoped the same (the per-story pick)
 *   headlineService  the feed's HeadlineService (required to compose)
 *   feedSourceAdapters, webContentAdapter  from installFeedApi
 *   loadCalendar(username)                 the user's current/calendar
 *   summarizeSchool({ studyDay })          SchoolParentDigest.summarize
 *   costReader                             the AI usage ledger (listCosts)
 */
export function createNewsReporterServices(config, { createRuntime }) {
  const {
    configService,
    printerRegistry,
    dataService,
    httpClient,
    model = null,
    mediaDir = null,
    logger = console,
    agentUsageRecorder = null,
    aiGateway = null,
    decisionGateway = null,
    headlineService = null,
    feedSourceAdapters = [],
    webContentAdapter = null,
    loadCalendar = null,
    summarizeSchool = null,
    costReader = null,
  } = config;

  const agentsConfig = configService?.getAppConfig?.('agents') || {};
  const defaultModel = model || agentsConfig?.models?.newsreporter || 'openai/gpt-4o';

  // Memoized per-model agent-runtime factory. Honors each reporter's
  // consolidate.model without re-creating a MastraAdapter on every call.
  const runtimeCache = new Map();
  const runtimeFor = (m) => {
    const key = m || defaultModel;
    if (!runtimeCache.has(key)) {
      runtimeCache.set(key, createRuntime({ model: key, logger, usageRecorder: agentUsageRecorder, mediaDir }));
    }
    return runtimeCache.get(key);
  };

  const renderer = new ReportReceiptRenderer();
  const sourceRegistry = createNewsSourceRegistry({ httpClient, logger });
  const jobDatastore = new NewsReporterJobDatastore({ configService, logger });
  const history = new YamlReportRunDatastore({ dataService, logger });

  return NewsReporterContainer.build({
    configProjection: new NewsReporterConfigProjection({ configService }),
    runtimeFor,
    defaultModel,
    renderer,
    sourceRegistry,
    jobDatastore,
    history,
    printerRegistry,
    logger,
    edition: {
      store: new YamlEditionDatastore({ dataService, mediaDir, logger }),
      renderer: new NewspaperRenderer(),
      timing: new NodeApplicationScheduler(),
      aiGateway,
      decisionGateway,
      costReader,
      headlineService,
      feedSources: feedSourceAdapters,
      webContent: webContentAdapter,
      loadCalendar,
      summarizeSchool,
    },
  });
}
