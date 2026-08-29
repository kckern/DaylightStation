import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { checkSchedule } from './scheduleCheck.mjs';

/**
 * Orchestrates content launch on target devices.
 * Resolves content -> validates device -> executes launch.
 */
export class LaunchService {
  #contentCatalog;
  #deviceLauncher;
  #loadSchedule;
  #findDeviceByConstraint;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.contentCatalog
   * @param {Object} config.deviceLauncher
   * @param {Function} [config.loadSchedule]
   * @param {Function} [config.findDeviceByConstraint]
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#contentCatalog = config.contentCatalog;
    this.#deviceLauncher = config.deviceLauncher;
    this.#loadSchedule = config.loadSchedule || (() => null);
    this.#findDeviceByConstraint = config.findDeviceByConstraint || (() => null);
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
    const resolved = this.#contentCatalog.resolve(contentId);
    if (!resolved) {
      throw new EntityNotFoundError('ContentSource', contentId);
    }

    const item = await this.#contentCatalog.getItem(resolved);
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

  /**
   * Resolve launch intent params for a content ID without executing.
   * Used by FKB clients to launch via fully.startIntent() instead of ADB.
   *
   * @param {string} contentId - Compound content ID
   * @returns {Promise<{ target: string, params: Object } | null>}
   */
  async resolveIntent(contentId) {
    const resolved = this.#contentCatalog.resolve(contentId);
    if (!resolved) return null;

    const item = await this.#contentCatalog.getItem(resolved);
    if (!item?.launchIntent) return null;

    return item.launchIntent;
  }

  #checkContentSchedule(contentId) {
    const { available, nextWindow } = checkSchedule(this.#loadSchedule());

    if (!available) {
      throw new ValidationError('Games are not available right now', {
        code: 'OUTSIDE_SCHEDULE',
        details: { nextWindow }
      });
    }
  }

}

export default LaunchService;
