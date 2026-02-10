// backend/src/domains/content/entities/Item.mjs

import { ValidationError } from '../../core/errors/index.mjs';
import { ItemId } from '../value-objects/ItemId.mjs';

/**
 * @typedef {Object} ItemActions
 * @property {Object} [play] - Play action parameters
 * @property {Object} [queue] - Queue action parameters
 * @property {Object} [list] - List action parameters
 */

/**
 * @typedef {Object} ItemProps
 * @property {string|ItemId} [id] - Compound ID: "source:localId" or ItemId instance
 * @property {ItemId} [itemId] - ItemId value object (alternative to id)
 * @property {string} [source] - Adapter source name (used with localId to create ItemId)
 * @property {string} [localId] - Source-specific ID (used with source to create ItemId)
 * @property {string} title - Display title
 * @property {string} [type] - Item type (e.g., 'talk', 'scripture', 'movie')
 * @property {string} [thumbnail] - Proxied thumbnail URL
 * @property {string} [description] - Item description
 * @property {Object} [metadata] - Additional metadata
 * @property {ItemActions} [actions] - Available actions for this item
 * @property {string} [assetId] - Optional override for asset identifier (defaults to id)
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
    if (!props.title) throw new ValidationError('Item requires title', { code: 'MISSING_TITLE', field: 'title' });

    // Construct ItemId from various input formats
    this.itemId = Item._resolveItemId(props);

    // Backward-compatible string properties
    this.id = this.itemId.toString();
    this.source = this.itemId.source;
    this.localId = this.itemId.localId;

    this.title = props.title;
    this.subtitle = props.subtitle ?? null;
    this.type = props.type ?? null;
    this.thumbnail = props.thumbnail ?? null;
    this.imageUrl = props.imageUrl ?? null;
    this.description = props.description ?? null;
    this.metadata = props.metadata ?? {};
    this.actions = props.actions ?? null;
    this._assetId = props.assetId ?? null;
    this._label = props.label ?? null;
  }

  /**
   * Resolve ItemId from various prop formats
   * @param {ItemProps} props
   * @returns {ItemId}
   * @private
   */
  static _resolveItemId(props) {
    // If itemId is already an ItemId instance
    if (props.itemId instanceof ItemId) {
      return props.itemId;
    }

    // If id is an ItemId instance
    if (props.id instanceof ItemId) {
      return props.id;
    }

    // If id is a string, parse it
    if (typeof props.id === 'string') {
      return ItemId.parse(props.id);
    }

    // If source and localId are provided, create from those
    if (props.source && props.localId) {
      return ItemId.from(props.source, String(props.localId));
    }

    throw new ValidationError('Item requires id (string or ItemId) or source+localId', {
      code: 'MISSING_ID',
      field: 'id'
    });
  }

  /**
   * Extract local ID from compound ID
   * @returns {string}
   */
  getLocalId() {
    return this.itemId.localId;
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
   * Get the asset identifier for logging/requests
   * @returns {string}
   */
  get assetId() {
    return this._assetId ?? this.id;
  }

  /**
   * Check if item is playable
   * @returns {boolean}
   */
  isPlayable() {
    return false;
  }
}

export default Item;
