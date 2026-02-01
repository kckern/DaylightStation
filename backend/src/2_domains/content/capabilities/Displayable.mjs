// backend/src/2_domains/content/capabilities/Displayable.mjs
import { ViewableItem } from './Viewable.mjs';

/**
 * Displayable capability - art for ambient TV display
 * Extends ViewableItem with art-specific metadata for context-aware selection
 */
export class DisplayableItem extends ViewableItem {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID (canvas:xyz)
   * @param {string} props.source - Adapter source
   * @param {string} props.title - Art title
   * @param {string} props.imageUrl - Full resolution image URL
   * @param {string} [props.category] - Art category (landscapes, abstract, etc.)
   * @param {string} [props.artist] - Artist name
   * @param {number} [props.year] - Creation year
   * @param {string[]} [props.tags] - Context tags (mood, time-of-day, season)
   * @param {string} [props.frameStyle] - Display frame style (minimal, classic, ornate, none)
   */
  constructor(props) {
    super(props);
    this.category = props.category ?? null;
    this.artist = props.artist ?? null;
    this.year = props.year ?? null;
    this.tags = props.tags ?? [];
    this.frameStyle = props.frameStyle ?? 'classic';
  }
}

export default DisplayableItem;
