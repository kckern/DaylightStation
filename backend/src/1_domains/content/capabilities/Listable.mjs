// backend/src/domains/content/capabilities/Listable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * @typedef {'container' | 'leaf'} ItemType
 */

/**
 * Listable capability - items that can appear in lists and be browsed.
 * Containers have children, leaves are terminal nodes.
 */
export class ListableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID: "source:localId"
   * @param {string} props.source - Adapter source name
   * @param {string} props.title - Display title
   * @param {ItemType} props.itemType - Whether item is a container or leaf
   * @param {number} [props.childCount] - Number of children (for containers)
   * @param {Array} [props.children] - Child items (for containers)
   * @param {number} [props.sortOrder] - Order in list
   * @param {string} [props.thumbnail] - Proxied thumbnail URL
   * @param {string} [props.description] - Item description
   * @param {Object} [props.metadata] - Additional metadata
   */
  constructor(props) {
    super(props);
    this.itemType = props.itemType;
    this.children = props.children ?? [];
    this.childCount = props.childCount ?? this.children.length;
    this.sortOrder = props.sortOrder ?? 0;
  }

  /**
   * Check if this item is a container (has children)
   * @returns {boolean}
   */
  isContainer() {
    return this.itemType === 'container';
  }

  /**
   * Serialize to JSON with 'items' instead of 'children' for frontend compatibility
   * @returns {Object}
   */
  toJSON() {
    const obj = { ...this };
    // Rename children to items for frontend compatibility
    if (obj.children) {
      obj.items = obj.children;
      delete obj.children;
    }
    return obj;
  }
}
