/**
 * HubConfig Aggregate Root
 * @module domains/playback-hub/entities/HubConfig
 *
 * The entire devices.yml file as a single aggregate. Members:
 *   - devices: HubDevice[]
 *   - scheduledFires: ScheduledFire[]
 *   - daylightStation: object|null  (raw user-config block)
 *
 * Aggregate-level invariants enforced at construction:
 *   1. Device color uniqueness
 *   2. Device MAC uniqueness
 *   3. ScheduledFire id uniqueness
 *   4. Every ScheduledFire.target references an existing device color
 *
 * Mutations return NEW HubConfig instances. The receiver is never mutated.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { HubDevice } from './HubDevice.mjs';
import { ScheduledFire } from './ScheduledFire.mjs';

/**
 * HubConfig aggregate root.
 */
export class HubConfig {
  /** @type {ReadonlyArray<HubDevice>} */ #devices;
  /** @type {ReadonlyArray<ScheduledFire>} */ #scheduledFires;
  /** @type {object|null} */ #daylightStation;

  /**
   * @param {{
   *   devices: HubDevice[],
   *   scheduledFires?: ScheduledFire[],
   *   daylightStation?: object|null
   * }} args
   */
  constructor({ devices, scheduledFires = [], daylightStation = null } = {}) {
    if (!Array.isArray(devices)) {
      throw new ValidationError('HubConfig.devices must be an array', {
        code: 'INVALID_HUB_CONFIG', field: 'devices', value: devices
      });
    }
    for (const d of devices) {
      if (!(d instanceof HubDevice)) {
        throw new ValidationError('HubConfig.devices entries must be HubDevice instances', {
          code: 'INVALID_HUB_CONFIG', field: 'devices', value: d
        });
      }
    }
    if (!Array.isArray(scheduledFires)) {
      throw new ValidationError('HubConfig.scheduledFires must be an array', {
        code: 'INVALID_HUB_CONFIG', field: 'scheduledFires', value: scheduledFires
      });
    }
    for (const f of scheduledFires) {
      if (!(f instanceof ScheduledFire)) {
        throw new ValidationError('HubConfig.scheduledFires entries must be ScheduledFire instances', {
          code: 'INVALID_HUB_CONFIG', field: 'scheduledFires', value: f
        });
      }
    }
    if (daylightStation !== null && (typeof daylightStation !== 'object' || Array.isArray(daylightStation))) {
      throw new ValidationError('HubConfig.daylightStation must be an object or null', {
        code: 'INVALID_HUB_CONFIG', field: 'daylightStation', value: daylightStation
      });
    }

    // Invariants 1 & 2: device color and MAC uniqueness.
    const seenColors = new Set();
    const seenMacs = new Set();
    for (const d of devices) {
      const c = d.color.value;
      if (seenColors.has(c)) {
        throw new DomainInvariantError(`duplicate device color: ${c}`, {
          code: 'DUPLICATE_DEVICE_COLOR', details: { color: c }
        });
      }
      seenColors.add(c);
      const m = d.mac;
      if (seenMacs.has(m)) {
        throw new DomainInvariantError(`duplicate device MAC: ${m}`, {
          code: 'DUPLICATE_DEVICE_MAC', details: { mac: m }
        });
      }
      seenMacs.add(m);
    }

    // Invariant 3: scheduledFire id uniqueness.
    const seenFireIds = new Set();
    for (const f of scheduledFires) {
      if (seenFireIds.has(f.id)) {
        throw new DomainInvariantError(`duplicate scheduledFire id: ${f.id}`, {
          code: 'DUPLICATE_SCHEDULED_FIRE_ID', details: { id: f.id }
        });
      }
      seenFireIds.add(f.id);
    }

    // Invariant 4: every fire's target references an existing device color.
    for (const f of scheduledFires) {
      if (!seenColors.has(f.target)) {
        throw new DomainInvariantError(
          `scheduledFire '${f.id}' target color '${f.target}' is not a known device`,
          { code: 'SCHEDULED_FIRE_TARGET_UNKNOWN', details: { id: f.id, target: f.target } }
        );
      }
    }

    this.#devices = Object.freeze([...devices]);
    this.#scheduledFires = Object.freeze([...scheduledFires]);
    this.#daylightStation = daylightStation === null
      ? null
      : Object.freeze({ ...daylightStation });
    Object.freeze(this);
  }

  /** @returns {ReadonlyArray<HubDevice>} */
  get devices() { return this.#devices; }
  /** @returns {ReadonlyArray<ScheduledFire>} */
  get scheduledFires() { return this.#scheduledFires; }
  /** @returns {object|null} */
  get daylightStation() { return this.#daylightStation; }

  /**
   * Find device by color string.
   * @param {string} color
   * @returns {HubDevice}
   * @throws {EntityNotFoundError}
   */
  findDevice(color) {
    const found = this.#devices.find(d => d.color.value === color);
    if (!found) {
      throw new EntityNotFoundError('HubDevice', color);
    }
    return found;
  }

  /**
   * Find scheduled fire by id.
   * @param {string} id
   * @returns {ScheduledFire}
   * @throws {EntityNotFoundError}
   */
  findScheduledFire(id) {
    const found = this.#scheduledFires.find(f => f.id === id);
    if (!found) {
      throw new EntityNotFoundError('ScheduledFire', id);
    }
    return found;
  }

  /**
   * Return a NEW HubConfig with the named device patched.
   * @param {string} color
   * @param {object} patch
   * @returns {HubConfig}
   * @throws {EntityNotFoundError}
   */
  patchDevice(color, patch) {
    const target = this.findDevice(color); // throws EntityNotFoundError if missing
    const updated = target.update(patch);
    const newDevices = this.#devices.map(d => d === target ? updated : d);
    return new HubConfig({
      devices: newDevices,
      scheduledFires: [...this.#scheduledFires],
      daylightStation: this.#daylightStation
    });
  }

  /**
   * Insert-or-replace by fire id. Returns NEW HubConfig.
   * Aggregate invariants are re-checked in the new constructor.
   * @param {ScheduledFire} fire
   * @returns {HubConfig}
   */
  upsertScheduledFire(fire) {
    if (!(fire instanceof ScheduledFire)) {
      throw new ValidationError('upsertScheduledFire requires a ScheduledFire instance', {
        code: 'INVALID_HUB_CONFIG', field: 'fire', value: fire
      });
    }
    const idx = this.#scheduledFires.findIndex(f => f.id === fire.id);
    const newFires = [...this.#scheduledFires];
    if (idx >= 0) {
      newFires[idx] = fire;
    } else {
      newFires.push(fire);
    }
    return new HubConfig({
      devices: [...this.#devices],
      scheduledFires: newFires,
      daylightStation: this.#daylightStation
    });
  }

  /**
   * Remove a fire by id. Throws if not found.
   * @param {string} id
   * @returns {HubConfig}
   * @throws {EntityNotFoundError}
   */
  removeScheduledFire(id) {
    const idx = this.#scheduledFires.findIndex(f => f.id === id);
    if (idx < 0) {
      throw new EntityNotFoundError('ScheduledFire', id);
    }
    const newFires = this.#scheduledFires.filter(f => f.id !== id);
    return new HubConfig({
      devices: [...this.#devices],
      scheduledFires: newFires,
      daylightStation: this.#daylightStation
    });
  }

  /**
   * Sparse-preserving YAML serialization.
   * @returns {object}
   */
  toYaml() {
    const out = {};
    out.devices = this.#devices.map(d => d.toYaml());
    if (this.#scheduledFires.length > 0) {
      out.scheduled = this.#scheduledFires.map(f => {
        const entry = {
          id: f.id,
          time: f.time,
          target: f.target,
          queue: f.queue.toString(),
          days: f.days.value
        };
        if (f.durationMin !== null) entry.duration_min = f.durationMin;
        if (f.volumeOverride !== null) entry.volume_override = f.volumeOverride;
        return entry;
      });
    }
    if (this.#daylightStation !== null) {
      out.daylight_station = { ...this.#daylightStation };
    }
    return out;
  }
}

export default HubConfig;
