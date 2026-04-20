export class ActivateDashboardScene {
  #configRepository;
  #haGateway;
  #logger;

  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('ActivateDashboardScene: configRepository required');
    if (!haGateway)        throw new Error('ActivateDashboardScene: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  async execute({ sceneId }) {
    const config = await this.#configRepository.load();
    const allowed = (config.summary?.scenes || []).some(s => s.id === sceneId);
    if (!allowed) {
      const err = new Error(`Scene ${sceneId} is not on dashboard`);
      err.status = 403;
      throw err;
    }
    this.#logger.info?.('home.dashboard.scene.activate', { sceneId });
    return this.#haGateway.activateScene(sceneId);
  }
}
export default ActivateDashboardScene;
