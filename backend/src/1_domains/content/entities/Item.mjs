// backend/src/domains/content/entities/Item.mjs

import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {Object} ItemActions
 * @property {Object} [play] - Play action parameters
 * @property {Object} [queue] - Queue action parameters
 * @property {Object} [list] - List action parameters
 */

/**
 * @typedef {Object} ItemProps
 * @property {string} id - Compound ID: "source:localId"
 * @property {string} source - Adapter source name
 * @property {string} localId - Source-specific ID (e.g., plex rating key)
 * @property {string} title - Display title
 * @property {string} [type] - Item type (e.g., 'talk', 'scripture', 'movie')
 * @property {string} [thumbnail] - Proxied thumbnail URL
 * @property {string} [description] - Item description
 * @property {Object} [metadata] - Additional metadata
 * @property {ItemActions} [actions] - Available actions for this item
 * @property {string} [media_key] - Optional override for media key (defaults to id)
 * @property {string} [label] - Short display label (falls back to title)
 */

/**
 * Base entity for all content items in the system.
 * Every object inherits from Item.
 */
export class Item {
  /**
   * @param {ItemProps} props
   */
  constructor(props) {
    if (!props.id) throw new ValidationError('Item requires id', { code: 'MISSING_ID', field: 'id' });
    if (!props.source) throw new ValidationError('Item requires source', { code: 'MISSING_SOURCE', field: 'source' });
    if (!props.title) throw new ValidationError('Item requires title', { code: 'MISSING_TITLE', field: 'title' });
    if (!props.localId) throw new ValidationError('Item requires localId', { code: 'MISSING_LOCAL_ID', field: 'localId' });

    this.id = props.id;
    this.source = props.source;
    this.localId = props.localId;
    this.title = props.title;
    this.type = props.type ?? null;
    this.thumbnail = props.thumbnail ?? null;
    this.description = props.description ?? null;
    this.metadata = props.metadata ?? {};
    this.actions = props.actions ?? null;
    this._media_key = props.media_key ?? null;
    this._label = props.label ?? null;
  }

  /**
   * Extract local ID from compound ID
   * @returns {string}
   */
  getLocalId() {
    const colonIndex = this.id.indexOf(':');
    return colonIndex > -1 ? this.id.substring(colonIndex + 1) : this.id;
  }

  /**
   * Get the plex rating key (for plex items)
   * @returns {string|null}
   */
  get plex() {
    if (this.source === 'plex') {
      return this.getLocalId();
    }
    return this.metadata?.plex ?? null;
  }

  /**
   * Get display label (falls back to title)
   * @returns {string}
   */
  get label() {
    return this._label || this.metadata?.label || this.title;
  }

  /**
   * Get the media key for logging/requests
   * @returns {string}
   */
  get media_key() {
    return this._media_key ?? this.id;
  }

  /**
   * Check if item is playable
   * @returns {boolean}
   */
  isPlayable() {
    return false;
  }
}
