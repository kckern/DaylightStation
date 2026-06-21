/**
 * NewsReporterContainer (3_applications — composition root).
 *
 * Wires the concrete adapters, renderer, registries, consolidator, history, and
 * service into a ready-to-use `{ service, jobDatastore, executor }` bundle that
 * app.mjs mounts. As a composition root, this is the one place in 3_app allowed
 * to import concrete 1_adapters / 1_rendering classes directly.
 *
 * @module 3_applications/newsreporter/NewsReporterContainer
 */

import { ReportReceiptRenderer } from '#rendering/newsreporter/ReportReceiptRenderer.mjs';
import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { createSourceRegistry } from '#adapters/newsreporter/sources/sourceRegistry.mjs';
import { NewsReporterJobDatastore } from '#adapters/newsreporter/NewsReporterJobDatastore.mjs';
import { YamlReportRunDatastore } from '#adapters/persistence/yaml/YamlReportRunDatastore.mjs';
import { Consolidator } from '#apps/newsreporter/Consolidator.mjs';
import { createSinkRegistry } from '#apps/newsreporter/sinks/sinkRegistry.mjs';
import { NewsReporterService } from '#apps/newsreporter/NewsReporterService.mjs';
import { NewsReporterJobExecutor } from '#apps/newsreporter/NewsReporterJobExecutor.mjs';

const DEFAULT_MODEL = 'openai/gpt-4o';

export class NewsReporterContainer {
  /**
   * @param {{
   *   configService: object,
   *   agentRuntimeDeps?: { model?: string, mediaDir?: string|null },
   *   printerRegistry: { resolve: Function },
   *   dataService: object,
   *   httpClient: object,
   *   logger?: object,
   * }} deps
   * @returns {{ service: NewsReporterService, jobDatastore: NewsReporterJobDatastore, executor: NewsReporterJobExecutor }}
   */
  static build({ configService, agentRuntimeDeps = {}, printerRegistry, dataService, httpClient, logger = console }) {
    const defaultModel = agentRuntimeDeps.model || DEFAULT_MODEL;
    const mediaDir = agentRuntimeDeps.mediaDir ?? null;

    // Memoized per-model agent runtime factory. Honors each reporter's
    // consolidate.model without re-creating a MastraAdapter on every call.
    const runtimeCache = new Map();
    const runtimeFor = (model) => {
      const key = model || defaultModel;
      if (!runtimeCache.has(key)) {
        runtimeCache.set(key, new MastraAdapter({ model: key, logger, mediaDir }));
      }
      return runtimeCache.get(key);
    };

    const renderer = new ReportReceiptRenderer();
    const consolidator = new Consolidator({ runtimeFor, logger, defaultModel });
    const sourceRegistry = createSourceRegistry({ httpClient, logger });
    const sinkRegistry = createSinkRegistry({ renderer, printerRegistry, logger });
    const history = new YamlReportRunDatastore({ dataService, logger });

    const service = new NewsReporterService({
      configService,
      sourceRegistry,
      consolidator,
      sinkRegistry,
      history,
      logger,
    });

    const jobDatastore = new NewsReporterJobDatastore({ configService, logger });

    const executor = new NewsReporterJobExecutor({
      newsReporterService: service,
      reporterIdProvider: () => jobDatastore.reporterIds(),
      logger,
    });

    return { service, jobDatastore, executor };
  }
}

export default NewsReporterContainer;
