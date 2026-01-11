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
   * @param {number} [props.sortOrder] - Order in list
   * @param {string} [props.thumbnail] - Proxied thumbnail URL
   * @param {string} [props.description] - Item description
   * @param {Object} [props.metadata] - Additional metadata
   */
  constructor(props) {
    super(props);
    this.itemType = props.itemType;
    this.childCount = props.childCount ?? 0;
    this.sortOrder = props.sortOrder ?? 0;
  }

  /**
   * Check if this item is a container (has children)
   * @returns {boolean}
   */
  isContainer() {
    return this.itemType === 'container';
  }
}
