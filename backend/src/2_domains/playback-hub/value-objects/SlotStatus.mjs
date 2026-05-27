/**
 * SlotStatus Value Object
 * @module domains/playback-hub/value-objects/SlotStatus
 *
 * Transient runtime snapshot of a slot's state — published by the
 * HubStatusBroadcaster. Fields follow the wire-shape documented in
 * `docs/_wip/plans/2026-05-27-playback-hub-admin-design.md` (snapshot section):
 *
 *   { position, color, bt_connected, paused, now_playing,
 *     volume, playlist_pos, playlist_count, armed_source }
 *
 * `now_playing` is null when nothing is playing; otherwise has the shape
 *   { queue: { source, id }, title? }
 *
 * `fromHubJson(json)` is the canonical mapper from the hub's `/api/status` JSON
 * (already in the post-broadcaster snapshot shape). The HTTP adapter handles
 * any earlier transformation from the raw mpv-introspection format.
 */

import { ValidationError } from '../../core/errors/ValidationError.mjs';

const REQUIRED_KEYS = Object.freeze([
  'position', 'color', 'bt_connected', 'paused', 'now_playing',
  'volume', 'playlist_pos', 'playlist_count', 'armed_source'
]);

/** @returns {boolean} */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Validate `now_playing` shape; throw on malformation. */
function validateNowPlaying(np) {
  if (np === null) return;
  if (!isPlainObject(np)) {
    throw new ValidationError('SlotStatus.now_playing must be an object or null', {
      code: 'INVALID_SLOT_STATUS',
      field: 'now_playing',
      value: np
    });
  }
  if (!isPlainObject(np.queue)) {
    throw new ValidationError('SlotStatus.now_playing.queue must be an object', {
      code: 'INVALID_SLOT_STATUS',
      field: 'now_playing.queue',
      value: np.queue
    });
  }
  if (typeof np.queue.source !== 'string' || np.queue.source.length === 0) {
    throw new ValidationError('SlotStatus.now_playing.queue.source must be a non-empty string', {
      code: 'INVALID_SLOT_STATUS',
      field: 'now_playing.queue.source',
      value: np.queue.source
    });
  }
  if (typeof np.queue.id !== 'string' || np.queue.id.length === 0) {
    throw new ValidationError('SlotStatus.now_playing.queue.id must be a non-empty string', {
      code: 'INVALID_SLOT_STATUS',
      field: 'now_playing.queue.id',
      value: np.queue.id
    });
  }
}

/**
 * SlotStatus value object.
 */
export class SlotStatus {
  /** @type {number} */ #position;
  /** @type {string} */ #color;
  /** @type {boolean} */ #bt_connected;
  /** @type {boolean} */ #paused;
  /** @type {object|null} */ #now_playing;
  /** @type {number} */ #volume;
  /** @type {number} */ #playlist_pos;
  /** @type {number} */ #playlist_count;
  /** @type {string|null} */ #armed_source;

  /**
   * @param {{
   *   position: number, color: string,
   *   bt_connected: boolean, paused: boolean,
   *   now_playing: {queue:{source:string,id:string}, title?:string}|null,
   *   volume: number, playlist_pos: number, playlist_count: number,
   *   armed_source: string|null
   * }} args
   */
  constructor(args) {
    if (!isPlainObject(args)) {
      throw new ValidationError('SlotStatus requires an object', {
        code: 'INVALID_SLOT_STATUS',
        value: args
      });
    }
    for (const k of REQUIRED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(args, k)) {
        throw new ValidationError(`SlotStatus.${k} is required`, {
          code: 'INVALID_SLOT_STATUS',
          field: k
        });
      }
    }
    if (typeof args.position !== 'number' || !Number.isInteger(args.position) || args.position < 1) {
      throw new ValidationError('SlotStatus.position must be a positive integer', {
        code: 'INVALID_SLOT_STATUS', field: 'position', value: args.position
      });
    }
    if (typeof args.color !== 'string' || args.color.length === 0) {
      throw new ValidationError('SlotStatus.color must be a non-empty string', {
        code: 'INVALID_SLOT_STATUS', field: 'color', value: args.color
      });
    }
    if (typeof args.bt_connected !== 'boolean') {
      throw new ValidationError('SlotStatus.bt_connected must be a boolean', {
        code: 'INVALID_SLOT_STATUS', field: 'bt_connected', value: args.bt_connected
      });
    }
    if (typeof args.paused !== 'boolean') {
      throw new ValidationError('SlotStatus.paused must be a boolean', {
        code: 'INVALID_SLOT_STATUS', field: 'paused', value: args.paused
      });
    }
    if (typeof args.volume !== 'number' || !Number.isFinite(args.volume)) {
      throw new ValidationError('SlotStatus.volume must be a finite number', {
        code: 'INVALID_SLOT_STATUS', field: 'volume', value: args.volume
      });
    }
    if (typeof args.playlist_pos !== 'number' || !Number.isFinite(args.playlist_pos)) {
      throw new ValidationError('SlotStatus.playlist_pos must be a finite number', {
        code: 'INVALID_SLOT_STATUS', field: 'playlist_pos', value: args.playlist_pos
      });
    }
    if (typeof args.playlist_count !== 'number' || !Number.isFinite(args.playlist_count)) {
      throw new ValidationError('SlotStatus.playlist_count must be a finite number', {
        code: 'INVALID_SLOT_STATUS', field: 'playlist_count', value: args.playlist_count
      });
    }
    if (args.armed_source !== null && typeof args.armed_source !== 'string') {
      throw new ValidationError('SlotStatus.armed_source must be a string or null', {
        code: 'INVALID_SLOT_STATUS', field: 'armed_source', value: args.armed_source
      });
    }
    validateNowPlaying(args.now_playing);

    this.#position = args.position;
    this.#color = args.color;
    this.#bt_connected = args.bt_connected;
    this.#paused = args.paused;
    this.#volume = args.volume;
    this.#playlist_pos = args.playlist_pos;
    this.#playlist_count = args.playlist_count;
    this.#armed_source = args.armed_source;

    if (args.now_playing === null) {
      this.#now_playing = null;
    } else {
      // Deep-freeze the now_playing payload so it's value-immutable.
      const npQueue = Object.freeze({
        source: args.now_playing.queue.source,
        id: args.now_playing.queue.id
      });
      const npOut = { queue: npQueue };
      if (Object.prototype.hasOwnProperty.call(args.now_playing, 'title')) {
        npOut.title = args.now_playing.title;
      }
      this.#now_playing = Object.freeze(npOut);
    }

    Object.freeze(this);
  }

  /** @returns {number} */
  get position() { return this.#position; }
  /** @returns {string} */
  get color() { return this.#color; }
  /** @returns {boolean} */
  get bt_connected() { return this.#bt_connected; }
  /** @returns {boolean} */
  get paused() { return this.#paused; }
  /** @returns {object|null} */
  get now_playing() { return this.#now_playing; }
  /** @returns {number} */
  get volume() { return this.#volume; }
  /** @returns {number} */
  get playlist_pos() { return this.#playlist_pos; }
  /** @returns {number} */
  get playlist_count() { return this.#playlist_count; }
  /** @returns {string|null} */
  get armed_source() { return this.#armed_source; }

  /**
   * Map a single hub-JSON snapshot entry into a SlotStatus.
   * @param {object} json
   * @returns {SlotStatus}
   */
  static fromHubJson(json) {
    if (!isPlainObject(json)) {
      throw new ValidationError('SlotStatus.fromHubJson expects an object', {
        code: 'INVALID_SLOT_STATUS',
        value: json
      });
    }
    return new SlotStatus({
      position: json.position,
      color: json.color,
      bt_connected: json.bt_connected,
      paused: json.paused,
      now_playing: json.now_playing ?? null,
      volume: json.volume,
      playlist_pos: json.playlist_pos,
      playlist_count: json.playlist_count,
      armed_source: json.armed_source ?? null
    });
  }
}

export default SlotStatus;
