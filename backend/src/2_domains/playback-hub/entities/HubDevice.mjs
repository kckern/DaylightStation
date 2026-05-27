/**
 * HubDevice Entity
 * @module domains/playback-hub/entities/HubDevice
 *
 * One physical slot on the playback hub. Member of the HubConfig aggregate.
 *
 * Identity: `color` (a SlotColor VO). Two HubDevice instances are the "same
 * device" iff their color values match — this is how the YAML keys live.
 *
 * Invariant: a public-class device MUST have a non-null haEntityId. The hub
 * cannot turn a public speaker on/off without HA integration, so a public
 * device with no entity is incoherent.
 *
 * Immutability: `update(patch)` returns a NEW HubDevice; the receiver is never
 * mutated. The new instance re-runs the invariant check.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../core/errors/DomainInvariantError.mjs';
import { SlotPosition } from '../value-objects/SlotPosition.mjs';
import { SlotColor } from '../value-objects/SlotColor.mjs';
import { SlotClass } from '../value-objects/SlotClass.mjs';
import { VolumeBounds } from '../value-objects/VolumeBounds.mjs';
import { ContinuousSchedule } from '../value-objects/ContinuousSchedule.mjs';

/**
 * HubDevice entity.
 */
export class HubDevice {
  /** @type {SlotPosition} */ #position;
  /** @type {SlotColor} */ #color;
  /** @type {string} */ #mac;
  /** @type {SlotClass} */ #class;
  /** @type {string|null} */ #haEntityId;
  /** @type {boolean} */ #haTurnOffOnStop;
  /** @type {VolumeBounds} */ #volumeBounds;
  /** @type {ReadonlyArray<ContinuousSchedule>} */ #continuousSchedules;

  /** @type {object} */ #extras;

  /**
   * @param {{
   *   position: SlotPosition,
   *   color: SlotColor,
   *   mac: string,
   *   class: SlotClass,
   *   haEntityId?: string|null,
   *   haTurnOffOnStop?: boolean,
   *   volumeBounds?: VolumeBounds,
   *   continuousSchedules?: ContinuousSchedule[],
   *   extras?: object|null
   * }} args
   *
   * `extras` is an optional plain object of arbitrary YAML keys not modeled
   * by the domain (e.g. `queue` — the per-device default queue, a hub-side
   * convenience field). The datastore preserves these so round-trip
   * read→write is non-destructive. Keys that collide with modeled fields
   * are silently overridden by the modeled values on toYaml emission.
   */
  constructor({
    position,
    color,
    mac,
    class: cls,
    haEntityId = null,
    haTurnOffOnStop = false,
    volumeBounds,
    continuousSchedules = [],
    extras = null
  } = {}) {
    if (!(position instanceof SlotPosition)) {
      throw new ValidationError('HubDevice.position must be a SlotPosition instance', {
        code: 'INVALID_HUB_DEVICE', field: 'position', value: position
      });
    }
    if (!(color instanceof SlotColor)) {
      throw new ValidationError('HubDevice.color must be a SlotColor instance', {
        code: 'INVALID_HUB_DEVICE', field: 'color', value: color
      });
    }
    if (typeof mac !== 'string' || mac.length === 0) {
      throw new ValidationError('HubDevice.mac must be a non-empty string', {
        code: 'INVALID_HUB_DEVICE', field: 'mac', value: mac
      });
    }
    if (!(cls instanceof SlotClass)) {
      throw new ValidationError('HubDevice.class must be a SlotClass instance', {
        code: 'INVALID_HUB_DEVICE', field: 'class', value: cls
      });
    }
    if (haEntityId !== null && (typeof haEntityId !== 'string' || haEntityId.length === 0)) {
      throw new ValidationError('HubDevice.haEntityId must be a non-empty string or null', {
        code: 'INVALID_HUB_DEVICE', field: 'haEntityId', value: haEntityId
      });
    }
    if (typeof haTurnOffOnStop !== 'boolean') {
      throw new ValidationError('HubDevice.haTurnOffOnStop must be a boolean', {
        code: 'INVALID_HUB_DEVICE', field: 'haTurnOffOnStop', value: haTurnOffOnStop
      });
    }
    const bounds = volumeBounds === undefined || volumeBounds === null
      ? new VolumeBounds({})
      : volumeBounds;
    if (!(bounds instanceof VolumeBounds)) {
      throw new ValidationError('HubDevice.volumeBounds must be a VolumeBounds instance', {
        code: 'INVALID_HUB_DEVICE', field: 'volumeBounds', value: volumeBounds
      });
    }
    if (!Array.isArray(continuousSchedules)) {
      throw new ValidationError('HubDevice.continuousSchedules must be an array', {
        code: 'INVALID_HUB_DEVICE', field: 'continuousSchedules', value: continuousSchedules
      });
    }
    for (const s of continuousSchedules) {
      if (!(s instanceof ContinuousSchedule)) {
        throw new ValidationError('HubDevice.continuousSchedules entries must be ContinuousSchedule instances', {
          code: 'INVALID_HUB_DEVICE', field: 'continuousSchedules', value: s
        });
      }
    }
    if (cls.isPublic && (haEntityId === null || haEntityId === '')) {
      throw new DomainInvariantError(
        `public device '${color.value}' requires ha_entity_id`,
        { code: 'PUBLIC_REQUIRES_HA_ENTITY', details: { color: color.value } }
      );
    }
    if (extras !== null && extras !== undefined) {
      if (typeof extras !== 'object' || Array.isArray(extras)) {
        throw new ValidationError('HubDevice.extras must be a plain object or null', {
          code: 'INVALID_HUB_DEVICE', field: 'extras', value: extras
        });
      }
    }
    this.#position = position;
    this.#color = color;
    this.#mac = mac;
    this.#class = cls;
    this.#haEntityId = haEntityId;
    this.#haTurnOffOnStop = haTurnOffOnStop;
    this.#volumeBounds = bounds;
    this.#continuousSchedules = Object.freeze([...continuousSchedules]);
    this.#extras = extras === null || extras === undefined ? null : Object.freeze({ ...extras });
    Object.freeze(this);
  }

  /** @returns {SlotPosition} */
  get position() { return this.#position; }
  /** @returns {SlotColor} */
  get color() { return this.#color; }
  /** @returns {string} */
  get mac() { return this.#mac; }
  /** @returns {SlotClass} */
  get class() { return this.#class; }
  /** @returns {string|null} */
  get haEntityId() { return this.#haEntityId; }
  /** @returns {boolean} */
  get haTurnOffOnStop() { return this.#haTurnOffOnStop; }
  /** @returns {VolumeBounds} */
  get volumeBounds() { return this.#volumeBounds; }
  /** @returns {ReadonlyArray<ContinuousSchedule>} */
  get continuousSchedules() { return this.#continuousSchedules; }
  /** @returns {object|null} */
  get extras() { return this.#extras; }

  /**
   * Return a NEW HubDevice with patched fields. Re-validates invariants.
   * @param {Partial<{
   *   position: SlotPosition, color: SlotColor, mac: string, class: SlotClass,
   *   haEntityId: string|null, haTurnOffOnStop: boolean,
   *   volumeBounds: VolumeBounds, continuousSchedules: ContinuousSchedule[]
   * }>} patch
   * @returns {HubDevice}
   */
  update(patch = {}) {
    return new HubDevice({
      position: 'position' in patch ? patch.position : this.#position,
      color: 'color' in patch ? patch.color : this.#color,
      mac: 'mac' in patch ? patch.mac : this.#mac,
      class: 'class' in patch ? patch.class : this.#class,
      haEntityId: 'haEntityId' in patch ? patch.haEntityId : this.#haEntityId,
      haTurnOffOnStop: 'haTurnOffOnStop' in patch ? patch.haTurnOffOnStop : this.#haTurnOffOnStop,
      volumeBounds: 'volumeBounds' in patch ? patch.volumeBounds : this.#volumeBounds,
      continuousSchedules: 'continuousSchedules' in patch ? patch.continuousSchedules : this.#continuousSchedules,
      extras: 'extras' in patch ? patch.extras : this.#extras
    });
  }

  /**
   * Sparse-preserving YAML serialization. Only emits fields the user would
   * have written: required fields always, optional fields only when set.
   * @returns {object}
   */
  toYaml() {
    const out = {
      slot: this.#position.value,
      color: this.#color.value,
      mac: this.#mac,
      class: this.#class.value
    };
    if (this.#haEntityId !== null) {
      out.ha_entity_id = this.#haEntityId;
    }
    if (this.#haTurnOffOnStop) {
      out.ha_turn_off_on_stop = true;
    }
    const volumeYaml = this.#volumeBounds.toYaml();
    if (Object.keys(volumeYaml).length > 0) {
      out.volume = volumeYaml;
    }
    if (this.#continuousSchedules.length > 0) {
      out.schedules = this.#continuousSchedules.map(s => {
        const entry = {
          start: s.start,
          end: s.end,
          queue: s.queue.toString()
        };
        if (s.shuffle) entry.shuffle = true;
        return entry;
      });
    }
    // Merge in any pass-through YAML keys not modeled by the domain
    // (e.g. `queue` — the hub-side default-queue convenience field).
    // Modeled keys always win on collision.
    if (this.#extras !== null) {
      for (const k of Object.keys(this.#extras)) {
        if (!(k in out)) {
          out[k] = this.#extras[k];
        }
      }
    }
    return out;
  }
}

export default HubDevice;
