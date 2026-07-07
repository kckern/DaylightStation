/**
 * SendHubCommand use case.
 *
 * Translates a user-level command intent into one or more gateway calls.
 *
 * Pipeline:
 *   1. Load HubConfig from the repository.
 *   2. Expand `target` (color | comma-list | group keyword) into HubDevice[].
 *      - 'all' / 'all-private' / 'all-public' resolve from device classes.
 *      - 'red,blue' → both devices.
 *      - 'red' → single device.
 *      - Unknown color anywhere → EntityNotFoundError.
 *   3. Construct a PlayCommand VO (validates action/queue/volume invariants).
 *   4. For each target device:
 *      a. Build a per-device PlayCommand with `volume` clamped to that device's
 *         VolumeBounds.max (so a hub-wide volume request never exceeds an
 *         individual headset's safety ceiling).
 *      b. Call `gateway.sendCommand(clamped, [device])`.
 *      c. On `InfrastructureError`, record `skipped[{reason:'unreachable'}]`
 *         for that color — do NOT abort the loop. Other targets still get a
 *         chance to respond.
 *      d. Merge applied + skipped across all per-device results.
 *
 * Returns one merged CommandResult; the API layer renders 200/502 from it.
 */

import { PlayCommand } from '#domains/playback-hub/value-objects/PlayCommand.mjs';
import { QueueRef } from '#domains/playback-hub/value-objects/QueueRef.mjs';
import { CommandResult } from '#domains/playback-hub/value-objects/CommandResult.mjs';
import { InfrastructureError } from '#system/utils/errors/InfrastructureError.mjs';

const GROUP_TARGETS = new Set(['all', 'all-private', 'all-public']);

export class SendHubCommand {
  /** @type {import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway} */ #gateway;
  /** @type {import('../ports/IHubConfigRepository.mjs').IHubConfigRepository} */ #repo;
  /** @type {object} */ #logger;

  /**
   * @param {{
   *   headsetHubGateway: import('../ports/IPlaybackHubGateway.mjs').IPlaybackHubGateway,
   *   hubConfigRepository: import('../ports/IHubConfigRepository.mjs').IHubConfigRepository,
   *   logger?: object
   * }} deps
   */
  constructor({ headsetHubGateway, hubConfigRepository, logger } = {}) {
    if (!headsetHubGateway) throw new Error('SendHubCommand: headsetHubGateway required');
    if (!hubConfigRepository) throw new Error('SendHubCommand: hubConfigRepository required');
    this.#gateway = headsetHubGateway;
    this.#repo = hubConfigRepository;
    this.#logger = logger || console;
  }

  /**
   * @param {{
   *   action: string,
   *   target: string,
   *   contentId?: string,
   *   volume?: number|null,
   *   durationMin?: number|null,
   *   resumePrevious?: boolean
   * }} input
   * @returns {Promise<CommandResult>}
   */
  async execute({ action, target, contentId = null, volume = null, durationMin = null, resumePrevious = false } = {}) {
    const config = await this.#repo.getConfig();
    const targets = this.#expandTargets(target, config);

    // Build the canonical PlayCommand once — domain invariants enforced here
    // (action/queue/volume validation).
    const queue = contentId != null && contentId !== '' ? QueueRef.parse(contentId) : null;
    const baseCommand = new PlayCommand({ action, queue, volume, durationMin });

    const applied = [];
    const skipped = [];

    for (const device of targets) {
      const perDeviceCommand = this.#clampForDevice(baseCommand, device);
      try {
        const result = await this.#gateway.sendCommand(perDeviceCommand, [device]);
        for (const color of result.applied) applied.push(color);
        for (const entry of result.skipped) skipped.push({ color: entry.color, reason: entry.reason });
      } catch (err) {
        if (err instanceof InfrastructureError) {
          this.#logger.warn?.('playback-hub.command.gateway_unreachable', {
            color: device.color.value, error: err.message
          });
          skipped.push({ color: device.color.value, reason: 'unreachable' });
        } else {
          throw err;
        }
      }
    }

    this.#logger.info?.('playback-hub.command.dispatched', {
      action, target, applied, skipped
    });

    return new CommandResult({ applied, skipped });
  }

  /**
   * Resolve the `target` string into a HubDevice[].
   * Unknown colors anywhere in a single/list target → EntityNotFoundError (via
   * HubConfig.findDevice).
   */
  #expandTargets(target, config) {
    if (typeof target !== 'string' || target.length === 0) {
      // Reuse the PlayCommand validation path indirectly — but we want a clean
      // EntityNotFoundError-ish message. Throw a generic Error which will surface
      // as a 400/500 via the API layer's mapping; SendHubCommand's contract is
      // to validate non-empty target.
      const err = new Error('SendHubCommand.target must be a non-empty string');
      err.code = 'INVALID_TARGET';
      throw err;
    }
    if (GROUP_TARGETS.has(target)) {
      const all = config.devices;
      if (target === 'all') return [...all];
      if (target === 'all-private') return all.filter(d => d.class.isPrivate);
      if (target === 'all-public') return all.filter(d => d.class.isPublic);
    }
    const colors = target.split(',').map(s => s.trim()).filter(Boolean);
    if (colors.length === 0) {
      const err = new Error('SendHubCommand.target resolved to an empty color list');
      err.code = 'INVALID_TARGET';
      throw err;
    }
    return colors.map(color => config.findDevice(color));
  }

  /**
   * Return a PlayCommand with `volume` clamped to the device's VolumeBounds.max.
   * For commands with no volume set, returns the original instance.
   */
  #clampForDevice(baseCommand, device) {
    if (baseCommand.volume === null) return baseCommand;
    const clamped = device.volumeBounds.clamp(baseCommand.volume);
    if (clamped === baseCommand.volume) return baseCommand;
    return new PlayCommand({
      action: baseCommand.action,
      queue: baseCommand.queue,
      volume: clamped,
      durationMin: baseCommand.durationMin
    });
  }
}

export default SendHubCommand;
