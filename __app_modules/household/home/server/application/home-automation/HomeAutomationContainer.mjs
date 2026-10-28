import {
  GetDashboardConfig, GetDashboardState, GetDashboardHistory,
  ToggleDashboardEntity, ActivateDashboardScene, GetHomeEntities,
  GetHomeTimeline, GetEntityHistory,
} from "./usecases/index.mjs";

export class HomeAutomationContainer {
  #configRepository;
  #haGateway;
  #entityGateway;
  #historyGateway;
  #timeZone;
  #clock;
  #logger;

  #getConfig; #getState; #getHistory; #toggle; #activateScene; #getEntities;
  #getTimeline; #getEntityHistory;

  /**
   * @param {Object} deps
   * @param {Object} deps.configRepository
   * @param {Object} deps.haGateway
   * @param {Object} [deps.entityGateway] - IHomeEntityGateway (entities, entity history)
   * @param {Object} [deps.historyGateway] - IHomeHistoryGateway (timeline, entity history)
   * @param {string} [deps.timeZone] - household IANA zone the timeline's days are local to
   * @param {() => number} [deps.clock] - the history use cases' "now"; composition hands the
   *   history gateway the same one, so a window's start and its open end agree
   * @param {Object} [deps.logger]
   */
  constructor({ configRepository, haGateway, entityGateway = null, historyGateway = null, timeZone = 'UTC', clock = Date.now, logger }) {
    if (!configRepository) throw new Error('HomeAutomationContainer: configRepository required');
    if (!haGateway)        throw new Error('HomeAutomationContainer: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#entityGateway = entityGateway;
    this.#historyGateway = historyGateway;
    this.#timeZone = timeZone;
    this.#clock = clock;
    this.#logger = logger || console;
  }

  getDashboardConfig() {
    if (!this.#getConfig) {
      this.#getConfig = new GetDashboardConfig({
        configRepository: this.#configRepository, logger: this.#logger,
      });
    }
    return this.#getConfig;
  }
  getDashboardState() {
    if (!this.#getState) {
      this.#getState = new GetDashboardState({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#getState;
  }
  getDashboardHistory() {
    if (!this.#getHistory) {
      this.#getHistory = new GetDashboardHistory({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#getHistory;
  }
  toggleDashboardEntity() {
    if (!this.#toggle) {
      this.#toggle = new ToggleDashboardEntity({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#toggle;
  }
  activateDashboardScene() {
    if (!this.#activateScene) {
      this.#activateScene = new ActivateDashboardScene({
        configRepository: this.#configRepository,
        haGateway: this.#haGateway, logger: this.#logger,
      });
    }
    return this.#activateScene;
  }
  getHomeEntities() {
    if (!this.#entityGateway) throw new Error('HomeAutomationContainer: entityGateway required for getHomeEntities');
    if (!this.#getEntities) {
      this.#getEntities = new GetHomeEntities({
        configRepository: this.#configRepository,
        entityGateway: this.#entityGateway, logger: this.#logger,
      });
    }
    return this.#getEntities;
  }
  getHomeTimeline() {
    if (!this.#historyGateway) throw new Error('HomeAutomationContainer: historyGateway required for getHomeTimeline');
    if (!this.#getTimeline) {
      this.#getTimeline = new GetHomeTimeline({
        configRepository: this.#configRepository,
        historyGateway: this.#historyGateway,
        timeZone: this.#timeZone, clock: this.#clock, logger: this.#logger,
      });
    }
    return this.#getTimeline;
  }
  getEntityHistory() {
    if (!this.#historyGateway) throw new Error('HomeAutomationContainer: historyGateway required for getEntityHistory');
    if (!this.#entityGateway)  throw new Error('HomeAutomationContainer: entityGateway required for getEntityHistory');
    if (!this.#getEntityHistory) {
      this.#getEntityHistory = new GetEntityHistory({
        configRepository: this.#configRepository,
        entityGateway: this.#entityGateway,
        historyGateway: this.#historyGateway,
        timeZone: this.#timeZone, clock: this.#clock, logger: this.#logger,
      });
    }
    return this.#getEntityHistory;
  }
}
export default HomeAutomationContainer;
