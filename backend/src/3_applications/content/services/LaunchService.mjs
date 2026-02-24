import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { checkSchedule } from './scheduleCheck.mjs';

/**
 * Orchestrates content launch on target devices.
 * Resolves content -> validates device -> executes launch.
 */
export class LaunchService {
  #contentRegistry;
  #deviceLauncher;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.contentRegistry
   * @param {Object} config.deviceLauncher
   * @param {Object} [config.configService]
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#contentRegistry = config.contentRegistry;
    this.#deviceLauncher = config.deviceLauncher;
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  /**
   * Launch content on a target device
   * @param {Object} input
   * @param {string} input.contentId - Compound ID (e.g. 'retroarch:n64/mario-kart-64')
   * @param {string} input.targetDeviceId - Device to launch on
   * @returns {Promise<{ success: boolean, contentId: string, targetDeviceId: string, title: string }>}
   */
  async launch({ contentId, targetDeviceId }) {
    this.#logger.info?.('launch.service.requested', { contentId, targetDeviceId });

    // 1. Resolve content
    const resolved = this.#contentRegistry.resolve(contentId);
    if (!resolved?.adapter) {
      throw new EntityNotFoundError('ContentSource', contentId);
    }

    const item = await resolved.adapter.getItem(resolved.localId);
    if (!item) {
      throw new EntityNotFoundError('Content', contentId);
    }

    if (!item.launchIntent) {
      throw new ValidationError('Content is not launchable', {
        code: 'NOT_LAUNCHABLE',
        field: 'launchIntent',
        value: contentId
      });
    }

    this.#logger.debug?.('launch.service.contentResolved', { contentId, title: item.title });

    // 1.5. Check content schedule
    this.#checkContentSchedule(contentId);

    // 2. Resolve target device
    let resolvedDeviceId = targetDeviceId;
    if (!resolvedDeviceId && item.deviceConstraint) {
      resolvedDeviceId = this.#findDeviceByConstraint(item.deviceConstraint);
      if (!resolvedDeviceId) {
        throw new ValidationError('No device matches constraint', {
          code: 'NO_MATCHING_DEVICE',
          field: 'deviceConstraint',
          value: item.deviceConstraint
        });
      }
      this.#logger.info?.('launch.service.deviceAutoResolved', { constraint: item.deviceConstraint, deviceId: resolvedDeviceId });
    }

    if (!resolvedDeviceId) {
      throw new ValidationError('No target device specified and content has no device constraint', {
        code: 'NO_TARGET_DEVICE'
      });
    }

    // 3. Validate device
    const canLaunch = await this.#deviceLauncher.canLaunch(resolvedDeviceId);
    if (!canLaunch) {
      throw new ValidationError('Target device does not support launch', {
        code: 'DEVICE_NOT_CAPABLE',
        field: 'targetDeviceId',
        value: resolvedDeviceId
      });
    }

    // 4. Execute
    await this.#deviceLauncher.launch(resolvedDeviceId, item.launchIntent);

    this.#logger.info?.('launch.service.success', { contentId, targetDeviceId: resolvedDeviceId, title: item.title });

    return { success: true, contentId, targetDeviceId: resolvedDeviceId, title: item.title };
  }

  #checkContentSchedule(contentId) {
    if (!this.#configService) return;

    const config = this.#configService.getHouseholdAppConfig(null, 'games');
    const { available, nextWindow } = checkSchedule(config?.schedule);

    if (!available) {
      throw new ValidationError('Games are not available right now', {
        code: 'OUTSIDE_SCHEDULE',
        details: { nextWindow }
      });
    }
  }

  #findDeviceByConstraint(constraint) {
    if (!this.#configService) return null;
    const devices = this.#configService.getHouseholdDevices();
    if (!devices?.devices) return null;
    for (const [id, config] of Object.entries(devices.devices)) {
      const fallback = config.content_control?.fallback;
      if (constraint === 'android' && fallback?.provider === 'adb') return id;
      if (config.type?.includes(constraint)) return id;
    }
    return null;
  }
}

export default LaunchService;
