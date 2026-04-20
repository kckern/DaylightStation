import {
  GetDashboardConfig, GetDashboardState, GetDashboardHistory,
  ToggleDashboardEntity, ActivateDashboardScene,
} from './usecases/index.mjs';

export class HomeAutomationContainer {
  #configRepository;
  #haGateway;
  #logger;

  #getConfig; #getState; #getHistory; #toggle; #activateScene;

  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('HomeAutomationContainer: configRepository required');
    if (!haGateway)        throw new Error('HomeAutomationContainer: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
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
}
export default HomeAutomationContainer;
