export class GetDashboardConfig {
  #configRepository;
  #logger;
  constructor({ configRepository, logger }) {
    if (!configRepository) throw new Error('GetDashboardConfig: configRepository required');
    this.#configRepository = configRepository;
    this.#logger = logger || console;
  }
  async execute() {
    return this.#configRepository.load();
  }
}
export default GetDashboardConfig;
