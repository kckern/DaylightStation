import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Orchestrates content launch on target devices.
 * Resolves content -> validates device -> executes launch.
 */
export class LaunchService {
  #contentRegistry;
  #deviceLauncher;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.contentRegistry
   * @param {Object} config.deviceLauncher
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#contentRegistry = config.contentRegistry;
    this.#deviceLauncher = config.deviceLauncher;
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

    // 2. Validate device
    const canLaunch = await this.#deviceLauncher.canLaunch(targetDeviceId);
    if (!canLaunch) {
      throw new ValidationError('Target device does not support launch', {
        code: 'DEVICE_NOT_CAPABLE',
        field: 'targetDeviceId',
        value: targetDeviceId
      });
    }

    // 3. Execute
    await this.#deviceLauncher.launch(targetDeviceId, item.launchIntent);

    this.#logger.info?.('launch.service.success', { contentId, targetDeviceId, title: item.title });

    return { success: true, contentId, targetDeviceId, title: item.title };
  }
}

export default LaunchService;
