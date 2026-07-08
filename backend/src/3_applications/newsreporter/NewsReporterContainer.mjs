/**
 * NewsReporterContainer (3_applications).
 *
 * Wires the application-layer pieces (consolidator, sink registry, service,
 * executor) into a ready-to-use `{ service, jobDatastore, executor }` bundle.
 * Concrete adapters and the renderer are constructed at the composition root
 * (bootstrap `createNewsReporterServices`) and injected here as instances
 * (Decision D1: containers never import concrete adapter or renderer
 * classes).
 *
 * @module 3_applications/newsreporter/NewsReporterContainer
 */

import { Consolidator } from '#apps/newsreporter/Consolidator.mjs';
import { createSinkRegistry } from '#apps/newsreporter/sinks/sinkRegistry.mjs';
import { NewsReporterService } from '#apps/newsreporter/NewsReporterService.mjs';
import { NewsReporterJobExecutor } from '#apps/newsreporter/NewsReporterJobExecutor.mjs';

export class NewsReporterContainer {
  /**
   * @param {{
   *   configService: object,
   *   runtimeFor: (model?: string) => object,
   *   defaultModel: string,
   *   renderer: object,
   *   sourceRegistry: { resolve: Function },
   *   jobDatastore: object,
   *   history: object,
   *   printerRegistry: { resolve: Function },
   *   logger?: object,
   * }} deps
   *   - runtimeFor: memoized per-model agent-runtime factory (built at the
   *     composition root; honors each reporter's consolidate.model).
   *   - defaultModel: framework default LLM, resolved from config at bootstrap.
   *   - renderer / sourceRegistry / jobDatastore / history: adapter and
   *     renderer instances constructed at the composition root.
   * @returns {{ service: NewsReporterService, jobDatastore: object, executor: NewsReporterJobExecutor }}
   */
  static build({ configService, runtimeFor, defaultModel, renderer, sourceRegistry, jobDatastore, history, printerRegistry, logger = console }) {
    const consolidator = new Consolidator({ runtimeFor, logger, defaultModel });
    const sinkRegistry = createSinkRegistry({ renderer, printerRegistry, logger });

    const service = new NewsReporterService({
      configService,
      sourceRegistry,
      consolidator,
      sinkRegistry,
      history,
      logger,
    });

    const executor = new NewsReporterJobExecutor({
      newsReporterService: service,
      reporterIdProvider: () => jobDatastore.reporterIds(),
      logger,
    });

    return { service, jobDatastore, executor };
  }
}

export default NewsReporterContainer;
