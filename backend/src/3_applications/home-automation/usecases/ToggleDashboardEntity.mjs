import { AuthorizationError } from '#system/utils/errors/index.mjs';

const VALID_STATES = new Set(['on', 'off', 'toggle']);

export class ToggleDashboardEntity {
  #configRepository;
  #haGateway;
  #logger;

  constructor({ configRepository, haGateway, logger }) {
    if (!configRepository) throw new Error('ToggleDashboardEntity: configRepository required');
    if (!haGateway)        throw new Error('ToggleDashboardEntity: haGateway required');
    this.#configRepository = configRepository;
    this.#haGateway = haGateway;
    this.#logger = logger || console;
  }

  async execute({ entityId, desiredState }) {
    if (!VALID_STATES.has(desiredState)) {
      throw new Error(`ToggleDashboardEntity: desiredState must be on|off|toggle, got ${desiredState}`);
    }
    const config = await this.#configRepository.load();
    if (!this.#isAllowed(config, entityId)) {
      throw new AuthorizationError(`Entity ${entityId} is not on dashboard`, { entityId });
    }
    const domain = entityId.split('.')[0];
    const service = desiredState === 'toggle' ? 'toggle'
                  : desiredState === 'on'     ? 'turn_on'
                  : 'turn_off';
    this.#logger.info?.('home.dashboard.toggle', { entityId, desiredState });
    return this.#haGateway.callService(domain, service, { entity_id: entityId });
  }

  #isAllowed(config, entityId) {
    for (const room of config.rooms || []) {
      for (const l of room.lights || []) {
        if (l.entity === entityId) return true;
      }
    }
    return false;
  }
}
export default ToggleDashboardEntity;
