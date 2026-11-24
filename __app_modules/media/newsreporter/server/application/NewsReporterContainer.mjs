/**
 * NewsReporterContainer (3_applications).
 *
 * Wires the application-layer pieces (consolidator, sink registry, service,
 * executor, and the edition kind's gatherer and service) into a ready-to-use
 * bundle. Concrete adapters and renderers are constructed at the composition
 * root (`createNewsReporterServices`) and injected here as instances
 * (Decision D1: containers never import concrete adapter or renderer
 * classes).
 *
 * @module 3_applications/newsreporter/NewsReporterContainer
 */

import { Consolidator } from "./Consolidator.mjs";
import { createSinkRegistry } from "./sinks/sinkRegistry.mjs";
import { NewsReporterService } from "./NewsReporterService.mjs";
import { NewsReporterJobExecutor } from "./NewsReporterJobExecutor.mjs";
import { EditionService } from "./EditionService.mjs";
import { EditionGatherer } from "./edition/editionGather.mjs";

export class NewsReporterContainer {
  /**
   * @param {{
   *   configProjection: object,
   *   runtimeFor: (model?: string) => object,
   *   defaultModel: string,
   *   renderer: object,
   *   sourceRegistry: { resolve: Function },
   *   jobDatastore: object,
   *   history: object,
   *   printerRegistry: { resolve: Function, get: Function },
   *   logger?: object,
   *   edition?: {
   *     store: object, renderer: object, timing?: object,
   *     aiGateway?: object, decisionGateway?: object, costReader?: object,
   *     headlineService?: object, feedSources?: object[], webContent?: object,
   *     loadCalendar?: Function, summarizeSchool?: Function,
   *   },
   * }} deps
   *   - runtimeFor: memoized per-model agent-runtime factory (built at the
   *     composition root; honors each reporter's consolidate.model).
   *   - defaultModel: framework default LLM, resolved from config at bootstrap.
   *   - renderer / sourceRegistry / jobDatastore / history: adapter and
   *     renderer instances constructed at the composition root.
   *   - edition: the edition kind's ports; absent → no edition reporters.
   * @returns {{ service, editionService, reporterDirectory, jobDatastore, executor }}
   */
  static build({ configProjection, runtimeFor, defaultModel, renderer, sourceRegistry, jobDatastore, history, printerRegistry, logger = console, edition = null }) {
    const consolidator = new Consolidator({ runtimeFor, logger, defaultModel });
    const sinkRegistry = createSinkRegistry({ renderer, printerRegistry, logger });

    const editionService = edition?.store && edition?.renderer
      ? new EditionService({
        configProjection,
        store: edition.store,
        gatherer: new EditionGatherer({
          headlineService: edition.headlineService ?? null,
          feedSources: edition.feedSources ?? [],
          loadCalendar: edition.loadCalendar ?? null,
          summarizeSchool: edition.summarizeSchool ?? null,
          webContent: edition.webContent ?? null,
          timing: edition.timing ?? null,
          logger,
        }),
        aiGateway: edition.aiGateway ?? null,
        decisionGateway: edition.decisionGateway ?? null,
        renderer: edition.renderer,
        printerRegistry,
        costReader: edition.costReader ?? null,
        logger,
      })
      : null;

    const service = new NewsReporterService({
      configProjection,
      sourceRegistry,
      consolidator,
      sinkRegistry,
      history,
      editionService,
      logger,
    });

    const executor = new NewsReporterJobExecutor({
      newsReporterService: service,
      reporterIdProvider: () => jobDatastore.reporterIds(),
      logger,
    });

    const reporterDirectory = {
      /** @returns {Array<{ id, kind, title, enabled }>} */
      list: () => Object.entries(configProjection.all?.() || {})
        .filter(([, cfg]) => cfg && typeof cfg === 'object')
        .map(([id, cfg]) => ({ id, kind: cfg.kind || 'report', title: cfg.title || id, enabled: cfg.enabled !== false })),
    };

    return { service, editionService, reporterDirectory, jobDatastore, executor };
  }
}

export default NewsReporterContainer;
