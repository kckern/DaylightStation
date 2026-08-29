/**
 * UpdateDeviceConfig use case.
 *
 * Patches a single HubDevice within the HubConfig aggregate and persists the
 * new aggregate. Returns the updated HubDevice.
 *
 * Accepts a protocol-neutral device configuration command. The HTTP adapter
 * translates its public wire names into this command before invoking the use
 * case; this use case then creates the domain value objects it needs.
 *
 * IMPORTANT — saving new volume bounds does NOT retroactively clamp a running
 * mpv on the hub. New bounds take effect on the next playback start (headset
 * reconnect, scheduled fire, or explicit Play Now). See design's note in the
 * `UpdateDeviceConfig` section. The frontend communicates this via tooltip.
 *
 * Failure semantics:
 *   - Unknown color → EntityNotFoundError (from HubConfig.findDevice).
 *   - Domain invariant violation (e.g. public class loses ha_entity_id) →
 *     thrown from HubDevice constructor; the save is NOT attempted.
 */

import { VolumeBounds } from '#domains/playback-hub/value-objects/VolumeBounds.mjs';
import { ContinuousSchedule } from '#domains/playback-hub/value-objects/ContinuousSchedule.mjs';
import { QueueRef } from '#domains/playback-hub/value-objects/QueueRef.mjs';

/**
 * Normalize a protocol-neutral configuration command into the domain shape
 * expected by HubDevice.update.
 * @param {object} raw
 * @returns {object}
 */
function normalizePatch(raw) {
  const out = {};

  // Pass-through simple keys (same name in both shapes).
  for (const k of ['position', 'color', 'mac', 'class']) {
    if (k in raw) out[k] = raw[k];
  }

  // Plain bounds are an application command, converted to the domain VO here.
  if ('volumeBounds' in raw) {
    out.volumeBounds = raw.volumeBounds instanceof VolumeBounds
      ? raw.volumeBounds : new VolumeBounds(raw.volumeBounds || {});
  }

  // A schedule command is converted to its domain VO here.
  if ('continuousSchedules' in raw) {
    out.continuousSchedules = Array.isArray(raw.continuousSchedules)
      ? raw.continuousSchedules.map(schedule =>
        schedule instanceof ContinuousSchedule ? schedule : new ContinuousSchedule({
          start: schedule?.start,
          end: schedule?.end,
          queue: schedule?.queue instanceof QueueRef ? schedule.queue : QueueRef.parse(String(schedule?.queue ?? '')),
          shuffle: schedule?.shuffle === true,
        }))
      : [];
  }

  // `null` deliberately clears the automation entity.
  if ('haEntityId' in raw) out.haEntityId = raw.haEntityId;

  if ('haTurnOffOnStop' in raw) out.haTurnOffOnStop = raw.haTurnOffOnStop === true;

  return out;
}

export class UpdateDeviceConfig {
  /** @type {import('../ports/IHubConfigRepository.mjs').IHubConfigRepository} */ #repo;
  /** @type {object} */ #logger;

  /**
   * @param {{
   *   hubConfigRepository: import('../ports/IHubConfigRepository.mjs').IHubConfigRepository,
   *   logger?: object
   * }} deps
   */
  constructor({ hubConfigRepository, logger } = {}) {
    if (!hubConfigRepository) {
      throw new Error('UpdateDeviceConfig: hubConfigRepository required');
    }
    this.#repo = hubConfigRepository;
    this.#logger = logger || console;
  }

  /**
   * @param {{ color: string, patch: object }} input
   * @returns {Promise<import('../../../2_domains/playback-hub/entities/HubDevice.mjs').HubDevice>}
   */
  async execute({ color, patch } = {}) {
    if (typeof color !== 'string' || color.length === 0) {
      const err = new Error('UpdateDeviceConfig.color must be a non-empty string');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    if (!patch || typeof patch !== 'object') {
      const err = new Error('UpdateDeviceConfig.patch must be an object');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    const config = await this.#repo.getConfig();
    // findDevice throws EntityNotFoundError on unknown color.
    config.findDevice(color);
    const domainPatch = normalizePatch(patch);
    // patchDevice returns a NEW HubConfig; throws on invariant violation
    // BEFORE we get a chance to save, so saveConfig is correctly skipped.
    const newConfig = config.patchDevice(color, domainPatch);
    await this.#repo.saveConfig(newConfig);
    this.#logger.info?.('playback-hub.config.updated', { what: 'device', id: color });
    return newConfig.findDevice(color);
  }
}

export default UpdateDeviceConfig;
