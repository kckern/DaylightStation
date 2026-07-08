/**
 * SaveScheduledFire use case.
 *
 * Insert-or-replace a scheduled fire by id. Accepts plain-data input from the
 * API layer; the use case constructs the ScheduledFire entity (with DayPattern
 * and QueueRef value objects), validates cross-aggregate invariants, and
 * persists.
 *
 * Pipeline:
 *   1. Load HubConfig.
 *   2. Construct ScheduledFire entity from input — parses `days` via DayPattern
 *      and `queue` via QueueRef.
 *   3. Validate against the current device map (target must exist; any
 *      volumeOverride must fit the target's bounds).
 *   4. config.upsertScheduledFire(fireEntity) — returns new HubConfig.
 *   5. saveConfig.
 *   6. Return the saved ScheduledFire.
 */

import { ScheduledFire } from '#domains/playback-hub/entities/ScheduledFire.mjs';
import { DayPattern } from '#domains/playback-hub/value-objects/DayPattern.mjs';
import { QueueRef } from '#domains/playback-hub/value-objects/QueueRef.mjs';

export class SaveScheduledFire {
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
      throw new Error('SaveScheduledFire: hubConfigRepository required');
    }
    this.#repo = hubConfigRepository;
    this.#logger = logger || console;
  }

  /**
   * @param {{
   *   fire: {
   *     id: string, time: string,
   *     days: string|string[],
   *     target: string,
   *     queue: string,
   *     durationMin?: number|null,
   *     volumeOverride?: number|null
   *   }
   * }} input
   * @returns {Promise<ScheduledFire>}
   */
  async execute({ fire } = {}) {
    if (!fire || typeof fire !== 'object') {
      const err = new Error('SaveScheduledFire.fire must be an object');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    const config = await this.#repo.getConfig();

    // Construct VOs first so domain errors surface clearly before we touch the
    // aggregate.
    const days = new DayPattern(fire.days);
    const queue = QueueRef.parse(fire.queue);
    const fireEntity = new ScheduledFire({
      id: fire.id,
      time: fire.time,
      days,
      target: fire.target,
      queue,
      durationMin: fire.durationMin ?? null,
      volumeOverride: fire.volumeOverride ?? null
    });

    // Cross-aggregate validation: target must exist; volumeOverride must fit.
    const slotsByColor = new Map();
    for (const d of config.devices) {
      slotsByColor.set(d.color.value, d);
    }
    fireEntity.validate(slotsByColor);

    const newConfig = config.upsertScheduledFire(fireEntity);
    await this.#repo.saveConfig(newConfig);
    this.#logger.info?.('playback-hub.config.updated', { what: 'fire', id: fireEntity.id });
    return fireEntity;
  }
}

export default SaveScheduledFire;
