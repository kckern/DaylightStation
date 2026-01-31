// backend/src/2_domains/content/capabilities/Viewable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * Viewable capability - static media for display (not played)
 * Use cases: Art display, single photo view, ambient backgrounds
 */
export class ViewableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID
   * @param {string} props.source - Adapter source
   * @param {string} props.title - Display title
   * @param {string} props.imageUrl - Full resolution image URL (proxied)
   * @param {string} [props.thumbnail] - Thumbnail URL (for previews)
   * @param {number} [props.width] - Image width
   * @param {number} [props.height] - Image height
   * @param {string} [props.mimeType] - image/jpeg, image/webp, etc.
   * @param {Object} [props.metadata] - EXIF, location, people, etc.
   */
  constructor(props) {
    super(props);
    this.imageUrl = props.imageUrl;
    this.width = props.width ?? null;
    this.height = props.height ?? null;
    this.mimeType = props.mimeType ?? null;
  }

  /**
   * Get aspect ratio (width / height)
   * @returns {number|null}
   */
  get aspectRatio() {
    if (!this.width || !this.height) return null;
    return this.width / this.height;
  }

  /**
   * Check if item is viewable
   * @returns {boolean}
   */
  isViewable() {
    return true;
  }
}

export default ViewableItem;
