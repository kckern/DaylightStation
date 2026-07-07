/**
 * UpdateDeviceConfig use case.
 *
 * Patches a single HubDevice within the HubConfig aggregate and persists the
 * new aggregate. Returns the updated HubDevice.
 *
 * Accepts patches in TWO shapes:
 *   - Wire shape (from the HTTP API / frontend):
 *       { volume: {default,min,max}, schedules: [{start,end,queue,shuffle}],
 *         ha_entity_id, ha_turn_off_on_stop, ... }
 *   - Domain shape (from in-process callers and tests):
 *       { volumeBounds: VolumeBounds, continuousSchedules: ContinuousSchedule[],
 *         haEntityId, haTurnOffOnStop, ... }
 *
 * Wire shape gets normalised to domain shape before reaching HubDevice.update.
 * Both shapes flow through the same domain invariants (so e.g. a public-class
 * device dropping `ha_entity_id` still throws DomainInvariantError).
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
 * Normalize a wire-shape patch (snake_case + plain values) into the domain
 * shape (camelCase + VO instances) expected by HubDevice.update. Domain-shape
 * keys in the patch take precedence over their wire-shape counterparts and
 * are passed through unmodified.
 * @param {object} raw
 * @returns {object}
 */
function normalizePatch(raw) {
  const out = {};

  // Pass-through simple keys (same name in both shapes).
  for (const k of ['position', 'color', 'mac', 'class']) {
    if (k in raw) out[k] = raw[k];
  }

  // volume (wire) → volumeBounds (domain). Plain {} accepted.
  if ('volume' in raw) {
    const v = raw.volume;
    out.volumeBounds = v instanceof VolumeBounds ? v : new VolumeBounds(v || {});
  }
  if ('volumeBounds' in raw) {
    out.volumeBounds = raw.volumeBounds;
  }

  // schedules (wire) → continuousSchedules (domain). Empty / non-array → [].
  if ('schedules' in raw) {
    out.continuousSchedules = Array.isArray(raw.schedules)
      ? raw.schedules.map(s =>
          s instanceof ContinuousSchedule ? s : new ContinuousSchedule({
            start: s?.start,
            end: s?.end,
            queue: s?.queue instanceof QueueRef ? s.queue : QueueRef.parse(String(s?.queue ?? '')),
            shuffle: s?.shuffle === true,
          })
        )
      : [];
  }
  if ('continuousSchedules' in raw) {
    out.continuousSchedules = raw.continuousSchedules;
  }

  // ha_entity_id (wire) → haEntityId (domain). null clears.
  if ('ha_entity_id' in raw) out.haEntityId = raw.ha_entity_id;
  if ('haEntityId' in raw) out.haEntityId = raw.haEntityId;

  // ha_turn_off_on_stop (wire) → haTurnOffOnStop (domain).
  if ('ha_turn_off_on_stop' in raw) out.haTurnOffOnStop = raw.ha_turn_off_on_stop === true;
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
