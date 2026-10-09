import { ReportReceiptRenderer } from "./rendering/ReportReceiptRenderer.mjs";
import { createSourceRegistry as createNewsSourceRegistry } from "./adapters/sources/sourceRegistry.mjs";
import { NewsReporterJobDatastore } from "./adapters/NewsReporterJobDatastore.mjs";
import { YamlReportRunDatastore } from "./adapters/persistence/YamlReportRunDatastore.mjs";
import { NewsReporterContainer } from "./application/NewsReporterContainer.mjs";
import { NewsReporterConfigProjection } from "./adapters/NewsReporterConfigProjection.mjs";

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
  });
}
