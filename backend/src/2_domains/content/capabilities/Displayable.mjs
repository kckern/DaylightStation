// backend/src/2_domains/content/capabilities/Displayable.mjs
import { Item } from '../entities/Item.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

/**
 * Displayable capability - static images for ambient display
 * Use cases: Art display, photo slideshows, ambient backgrounds
 *
 * Distinct from Playable (has timeline, can pause/seek) - Displayable is static.
 */
export class DisplayableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID (canvas:xyz, immich:abc)
   * @param {string} props.source - Adapter source
   * @param {string} props.title - Display title
   * @param {string} props.imageUrl - Full resolution image URL (proxied)
   * @param {string} [props.thumbnail] - Thumbnail URL (for previews)
   * @param {number} [props.width] - Image width
   * @param {number} [props.height] - Image height
   * @param {string} [props.mimeType] - image/jpeg, image/webp, etc.
   * @param {Object} [props.metadata] - EXIF, location, people, etc.
   * @param {string} [props.category] - Art category (landscapes, abstract, etc.)
   * @param {string} [props.artist] - Artist/photographer name
   * @param {number} [props.year] - Creation year
   * @param {string[]} [props.tags] - Context tags (mood, time-of-day, season)
   * @param {string} [props.frameStyle] - Display frame style (minimal, classic, ornate, none)
   */
  constructor(props) {
    super(props);
    if (!props.imageUrl) {
      throw new ValidationError('DisplayableItem requires imageUrl', {
        code: 'MISSING_IMAGE_URL',
        field: 'imageUrl'
      });
    }
    // Core image properties
    this.imageUrl = props.imageUrl;
    this.width = props.width ?? null;
    this.height = props.height ?? null;
    this.mimeType = props.mimeType ?? null;
    // Art/display metadata
    this.category = props.category ?? null;
    this.artist = props.artist ?? null;
    this.year = props.year ?? null;
    this.tags = props.tags ?? [];
    this.frameStyle = props.frameStyle ?? 'classic';
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
   * Check if item is displayable
   * @returns {boolean}
   */
  isDisplayable() {
    return true;
  }
}

export default DisplayableItem;
