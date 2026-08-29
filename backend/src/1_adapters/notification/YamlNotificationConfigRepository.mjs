import { INotificationConfigRepository } from '#apps/notification/ports/INotificationConfigRepository.mjs';

/** Owns notification config addressing, YAML persistence, and cache refresh. */
export class YamlNotificationConfigRepository extends INotificationConfigRepository {
  #configService;
  #configFiles;

  constructor({ configService, configFiles }) {
    super();
    this.#configService = configService;
    this.#configFiles = configFiles;
  }

  load() {
    return this.#configService.reloadHouseholdAppConfig?.(null, 'notifications') || {};
  }

  save(config) {
    const location = this.#configService.getHouseholdAppConfigPath(null, 'notifications');
    this.#configFiles.writeYaml(location, config);
    this.#configService.reloadHouseholdAppConfig?.(null, 'notifications');
  }
}
