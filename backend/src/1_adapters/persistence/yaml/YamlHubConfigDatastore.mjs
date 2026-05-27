/**
 * YamlHubConfigDatastore — IHubConfigRepository via YAML file I/O.
 *
 * Reads + writes the playback hub's `devices.yml`. Used by DaylightStation to
 * remotely edit the hub config; the hub then rsyncs the file within 60s.
 *
 * Design notes:
 *   - Read path validates against the same 11 rules as the hub-side
 *     `_extensions/playback-hub/validate_config.py`. Drift is caught by the
 *     shared fixture set under `tests/fixtures/playback-hub/`.
 *   - Write path is atomic: write to a staging file, then rename. On rename
 *     failure the original file is intact.
 *   - Concurrent saves are serialized by an in-process Promise-chain mutex,
 *     so two simultaneous PATCH/PUT requests within DS don't lose either
 *     write at the YAML level. (Cross-process locking via flock is future
 *     work — DS runs single-process today.)
 *   - HubDevice `extras` is used to preserve YAML keys not modeled by the
 *     domain (e.g. the per-device `queue` default-queue convenience field).
 *     Round-trip read→save is non-destructive for those keys.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { IHubConfigRepository } from '../../../3_applications/playback-hub/ports/IHubConfigRepository.mjs';
import { HubConfig } from '../../../2_domains/playback-hub/entities/HubConfig.mjs';
import { HubDevice } from '../../../2_domains/playback-hub/entities/HubDevice.mjs';
import { ScheduledFire } from '../../../2_domains/playback-hub/entities/ScheduledFire.mjs';
import { SlotPosition } from '../../../2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { SlotColor } from '../../../2_domains/playback-hub/value-objects/SlotColor.mjs';
import { SlotClass } from '../../../2_domains/playback-hub/value-objects/SlotClass.mjs';
import { VolumeBounds } from '../../../2_domains/playback-hub/value-objects/VolumeBounds.mjs';
import { ContinuousSchedule } from '../../../2_domains/playback-hub/value-objects/ContinuousSchedule.mjs';
import { DayPattern } from '../../../2_domains/playback-hub/value-objects/DayPattern.mjs';
import { QueueRef } from '../../../2_domains/playback-hub/value-objects/QueueRef.mjs';
import { ValidationError } from '../../../2_domains/core/errors/ValidationError.mjs';
import { InfrastructureError } from '../../../0_system/utils/errors/InfrastructureError.mjs';

const VALID_CLASS = new Set(['private', 'public']);
const VALID_DAY_STRINGS = new Set(['all', 'weekdays', 'weekends']);
const VALID_DAY_NAMES = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

const MODELED_DEVICE_KEYS = new Set([
  'slot', 'color', 'mac', 'class', 'ha_entity_id', 'ha_turn_off_on_stop',
  'volume', 'continuous'
]);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export class YamlHubConfigDatastore extends IHubConfigRepository {
  /** @type {string} */ #yamlPath;
  /** @type {object} */ #logger;
  /** @type {Promise<unknown>} */ #saveMutex = Promise.resolve();

  /**
   * @param {{ yamlPath: string, logger?: object }} opts
   */
  constructor({ yamlPath, logger } = {}) {
    super();
    if (typeof yamlPath !== 'string' || yamlPath.length === 0) {
      throw new InfrastructureError('YamlHubConfigDatastore requires yamlPath', {
        code: 'MISSING_CONFIG', field: 'yamlPath'
      });
    }
    this.#yamlPath = yamlPath;
    this.#logger = logger || console;
  }

  /** @returns {Promise<HubConfig>} */
  async getConfig() {
    let raw;
    try {
      raw = await fs.readFile(this.#yamlPath, 'utf8');
    } catch (err) {
      throw new InfrastructureError(`failed to read ${this.#yamlPath}: ${err.message}`, {
        code: 'YAML_READ_FAILED', cause: err.message
      });
    }
    let parsed;
    try {
      parsed = yaml.load(raw);
    } catch (err) {
      throw new ValidationError(`malformed YAML in ${this.#yamlPath}: ${err.message}`, {
        code: 'YAML_PARSE_FAILED'
      });
    }
    this.#validate(parsed);
    return this.#build(parsed);
  }

  /** @param {HubConfig} hubConfig @returns {Promise<void>} */
  async saveConfig(hubConfig) {
    if (!(hubConfig instanceof HubConfig)) {
      throw new ValidationError('saveConfig requires a HubConfig instance', {
        code: 'INVALID_HUB_CONFIG', value: hubConfig
      });
    }
    // Chain onto the existing mutex so concurrent saves run serially. Catch
    // is attached AFTER awaiting so the caller still sees the rejection, but
    // the mutex itself never carries a rejected state (a single failure
    // would otherwise block every subsequent save).
    const next = this.#saveMutex.then(() => this.#doSave(hubConfig));
    this.#saveMutex = next.catch(() => {});
    return next;
  }

  // -----------------------------------------------------------------------
  // Private — validation (JS-side mirror of validate_config.py)
  // -----------------------------------------------------------------------

  /**
   * Validate the parsed YAML against the 11 rules defined in
   * `_extensions/playback-hub/validate_config.py`. The fixture set under
   * `tests/fixtures/playback-hub/` keeps the two validators in lockstep.
   * @param {object} doc
   * @private
   */
  #validate(doc) {
    // Rule 1: top-level is a mapping (non-null plain object).
    if (!isPlainObject(doc)) {
      throw new ValidationError('config validation failed: YAML root must be a mapping', {
        code: 'YAML_NOT_MAPPING'
      });
    }

    // Rule 2: `devices` is a non-empty list.
    const devices = doc.devices;
    if (!Array.isArray(devices) || devices.length === 0) {
      throw new ValidationError('config validation failed: `devices` must be a non-empty list', {
        code: 'DEVICES_EMPTY'
      });
    }

    const seenColors = [];
    const seenMacs = [];
    for (let i = 0; i < devices.length; i++) {
      const dev = devices[i];
      if (!isPlainObject(dev)) {
        throw new ValidationError(`config validation failed: devices[${i}] must be a mapping`, {
          code: 'DEVICE_NOT_MAPPING', index: i
        });
      }
      const color = dev.color;
      if (!color) {
        throw new ValidationError(`config validation failed: devices[${i}] missing canonical id 'color'`, {
          code: 'DEVICE_MISSING_COLOR', index: i
        });
      }
      // Rule 3: color uniqueness.
      if (seenColors.includes(color)) {
        throw new ValidationError(`config validation failed: duplicate color '${color}'`, {
          code: 'DUPLICATE_COLOR', value: color
        });
      }
      seenColors.push(color);

      // Rule 4: MAC uniqueness (when present).
      const mac = dev.mac;
      if (mac) {
        if (seenMacs.includes(mac)) {
          throw new ValidationError(`config validation failed: duplicate mac '${mac}' (device '${color}')`, {
            code: 'DUPLICATE_MAC', value: mac
          });
        }
        seenMacs.push(mac);
      }

      // Rule 5: class enum (default 'private').
      const cls = dev.class === undefined ? 'private' : dev.class;
      if (!VALID_CLASS.has(cls)) {
        throw new ValidationError(
          `config validation failed: device '${color}' class must be private or public, got '${cls}'`,
          { code: 'INVALID_CLASS', value: cls }
        );
      }

      // Rule 6: public requires ha_entity_id.
      if (cls === 'public' && !dev.ha_entity_id) {
        throw new ValidationError(
          `config validation failed: public device '${color}' requires ha_entity_id`,
          { code: 'PUBLIC_REQUIRES_HA_ENTITY', color }
        );
      }

      // Rule 7: volume bounds.
      if ('volume' in dev && dev.volume !== null && dev.volume !== undefined) {
        this.#validateVolume(color, dev.volume);
      }
    }

    // Rule 8 + 9 + 10: scheduled[] rules.
    const scheduled = doc.scheduled;
    if (scheduled !== undefined && scheduled !== null) {
      if (!Array.isArray(scheduled)) {
        throw new ValidationError(
          `config validation failed: 'scheduled' must be a list`,
          { code: 'SCHEDULED_NOT_LIST' }
        );
      }
      for (let i = 0; i < scheduled.length; i++) {
        const sch = scheduled[i];
        if (!isPlainObject(sch)) {
          throw new ValidationError(`config validation failed: scheduled[${i}] must be a mapping`, {
            code: 'SCHEDULED_NOT_MAPPING', index: i
          });
        }
        if (!seenColors.includes(sch.target)) {
          throw new ValidationError(
            `config validation failed: scheduled[${i}] target '${sch.target}' not a known device color`,
            { code: 'SCHEDULED_TARGET_UNKNOWN', index: i, target: sch.target }
          );
        }
        if (!sch.time) {
          throw new ValidationError(`config validation failed: scheduled[${i}] missing 'time'`, {
            code: 'SCHEDULED_MISSING_TIME', index: i
          });
        }
        if (!sch.queue) {
          throw new ValidationError(`config validation failed: scheduled[${i}] missing 'queue'`, {
            code: 'SCHEDULED_MISSING_QUEUE', index: i
          });
        }
        const days = sch.days === undefined ? 'all' : sch.days;
        if (typeof days === 'string') {
          if (!VALID_DAY_STRINGS.has(days)) {
            throw new ValidationError(
              `config validation failed: scheduled[${i}] days string must be all|weekdays|weekends, got '${days}'`,
              { code: 'SCHEDULED_DAYS_BAD', index: i, value: days }
            );
          }
        } else if (Array.isArray(days)) {
          for (const d of days) {
            if (!VALID_DAY_NAMES.has(d)) {
              throw new ValidationError(
                `config validation failed: scheduled[${i}] days list contains invalid day '${d}'`,
                { code: 'SCHEDULED_DAYS_BAD', index: i, value: d }
              );
            }
          }
        } else {
          throw new ValidationError(
            `config validation failed: scheduled[${i}] days must be string or list`,
            { code: 'SCHEDULED_DAYS_BAD', index: i, value: days }
          );
        }
      }
    }

    // Rule 11: daylight_station.base_url.
    const ds = doc.daylight_station;
    if (ds !== undefined && ds !== null) {
      if (!isPlainObject(ds)) {
        throw new ValidationError('config validation failed: daylight_station must be a mapping', {
          code: 'DS_NOT_MAPPING'
        });
      }
      if (!ds.base_url) {
        throw new ValidationError(
          'config validation failed: daylight_station.base_url is required when daylight_station block is present',
          { code: 'DS_MISSING_BASE_URL' }
        );
      }
    }
  }

  /** @private */
  #validateVolume(color, vol) {
    if (!isPlainObject(vol)) {
      throw new ValidationError(`config validation failed: device '${color}' volume must be a mapping`, {
        code: 'INVALID_VOLUME', color
      });
    }
    const vmin = vol.min === undefined ? 0 : vol.min;
    const vmax = vol.max === undefined ? 100 : vol.max;
    const vdef = vol.default === undefined ? 60 : vol.default;
    for (const [k, v] of [['min', vmin], ['max', vmax], ['default', vdef]]) {
      if (typeof v !== 'number' || v < 0 || v > 100) {
        throw new ValidationError(
          `config validation failed: device '${color}' volume.${k} must be 0-100, got ${JSON.stringify(v)}`,
          { code: 'INVALID_VOLUME', color, field: k, value: v }
        );
      }
    }
    if (!(vmin <= vdef && vdef <= vmax)) {
      throw new ValidationError(
        `config validation failed: device '${color}' volume: min(${vmin}) <= default(${vdef}) <= max(${vmax}) violated`,
        { code: 'INVALID_VOLUME_BOUNDS', color }
      );
    }
  }

  // -----------------------------------------------------------------------
  // Private — build HubConfig from validated YAML
  // -----------------------------------------------------------------------

  /**
   * @param {object} doc
   * @returns {HubConfig}
   * @private
   */
  #build(doc) {
    const devices = doc.devices.map((dev, i) => {
      const slotPos = typeof dev.slot === 'number' && Number.isInteger(dev.slot) && dev.slot >= 1
        ? dev.slot
        : i + 1; // fallback ordinal — validator didn't require slot
      const cls = dev.class === undefined ? 'private' : dev.class;
      const haEntityId = dev.ha_entity_id ?? null;
      const haTurnOffOnStop = dev.ha_turn_off_on_stop === true;
      const volumeBounds = ('volume' in dev && dev.volume !== null && dev.volume !== undefined)
        ? new VolumeBounds(dev.volume)
        : new VolumeBounds({});
      const continuous = Array.isArray(dev.continuous)
        ? dev.continuous.map(c => new ContinuousSchedule({
            start: c.start,
            end: c.end,
            queue: c.queue instanceof QueueRef ? c.queue : QueueRef.parse(String(c.queue)),
            shuffle: c.shuffle === true
          }))
        : [];

      // Extras: every key NOT in the modeled set, preserved verbatim.
      const extras = {};
      let hasExtras = false;
      for (const k of Object.keys(dev)) {
        if (!MODELED_DEVICE_KEYS.has(k)) {
          extras[k] = dev[k];
          hasExtras = true;
        }
      }

      return new HubDevice({
        position: new SlotPosition(slotPos),
        color: new SlotColor(dev.color),
        mac: dev.mac || '',
        class: new SlotClass(cls),
        haEntityId,
        haTurnOffOnStop,
        volumeBounds,
        continuousSchedules: continuous,
        extras: hasExtras ? extras : null
      });
    });

    const fires = Array.isArray(doc.scheduled)
      ? doc.scheduled.map((sch, i) => new ScheduledFire({
          id: typeof sch.id === 'string' && sch.id.length > 0 ? sch.id : `fire-${i + 1}`,
          time: sch.time,
          days: new DayPattern(sch.days === undefined ? 'all' : sch.days),
          target: sch.target,
          queue: QueueRef.parse(String(sch.queue)),
          durationMin: typeof sch.duration_min === 'number' ? sch.duration_min : null,
          volumeOverride: typeof sch.volume_override === 'number' ? sch.volume_override : null
        }))
      : [];

    const daylightStation = isPlainObject(doc.daylight_station) ? { ...doc.daylight_station } : null;

    return new HubConfig({
      devices,
      scheduledFires: fires,
      daylightStation
    });
  }

  // -----------------------------------------------------------------------
  // Private — atomic write
  // -----------------------------------------------------------------------

  /**
   * @param {HubConfig} hubConfig
   * @private
   */
  async #doSave(hubConfig) {
    const yamlObj = hubConfig.toYaml();
    // Re-run validation on the about-to-be-written form. Catches any drift
    // between domain invariants and YAML schema.
    this.#validate(yamlObj);
    const text = yaml.dump(yamlObj, { sortKeys: false, lineWidth: 1000 });
    const dir = path.dirname(this.#yamlPath);
    const stagingPath = `${this.#yamlPath}.staging.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(stagingPath, text, 'utf8');
    } catch (err) {
      throw new InfrastructureError(`failed to write staging file: ${err.message}`, {
        code: 'YAML_STAGING_FAILED', cause: err.message, path: stagingPath
      });
    }
    try {
      await fs.rename(stagingPath, this.#yamlPath);
    } catch (err) {
      // Clean up the staging file — original file remains intact.
      await fs.unlink(stagingPath).catch(() => {});
      throw new InfrastructureError(`failed to rename staging into place: ${err.message}`, {
        code: 'YAML_RENAME_FAILED', cause: err.message, path: this.#yamlPath, stagingPath
      });
    }
    this.#logger.info?.('playback-hub.config.saved', {
      path: this.#yamlPath, deviceCount: hubConfig.devices.length
    });
  }
}

export default YamlHubConfigDatastore;
