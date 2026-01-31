// backend/src/2_domains/content/capabilities/Readable.mjs
import { Item } from '../entities/Item.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {'paged' | 'flow'} ContentType
 * @typedef {'single' | 'double' | 'webtoon'} PageLayout
 * @typedef {'ltr' | 'rtl' | 'ttb'} ReadingDirection
 */

/**
 * Readable capability - page-turn content (comics, ebooks, PDFs, magazines)
 *
 * Two content types:
 * - paged: Fixed pages with known total (comics, PDFs, magazines)
 * - flow: Reflowable content without fixed pages (ebooks with epub format)
 */
export class ReadableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID: "source:localId"
   * @param {string} props.source - Adapter source name
   * @param {string} props.title - Display title
   * @param {ContentType} props.contentType - 'paged' or 'flow'
   * @param {string} props.format - File format (cbz, cbr, epub, pdf, etc.)
   * @param {number} [props.totalPages] - Total pages (required for paged content)
   * @param {string} [props.contentUrl] - Content URL (required for flow content)
   * @param {PageLayout} [props.pageLayout='single'] - Page layout mode
   * @param {ReadingDirection} [props.readingDirection='ltr'] - Reading direction
   * @param {Function} [props._getPageUrl] - Function to generate page URL
   * @param {string} [props.manifestUrl] - Manifest URL for reader
   * @param {boolean} [props.resumable=true] - Whether reading can be resumed
   * @param {number} [props.resumePosition] - Current page (paged) or percent (flow)
   * @param {string} [props.audioItemId] - Linked audio item for read-along
   * @param {string} [props.thumbnail] - Thumbnail URL
   * @param {string} [props.description] - Item description
   * @param {Object} [props.metadata] - Additional metadata
   */
  constructor(props) {
    super(props);

    // Required fields
    if (!props.contentType) {
      throw new ValidationError('ReadableItem requires contentType', {
        code: 'MISSING_CONTENT_TYPE',
        field: 'contentType'
      });
    }
    if (!props.format) {
      throw new ValidationError('ReadableItem requires format', {
        code: 'MISSING_FORMAT',
        field: 'format'
      });
    }

    // Content-type specific validation
    if (props.contentType === 'paged' && props.totalPages === undefined) {
      throw new ValidationError('Paged content requires totalPages', {
        code: 'MISSING_TOTAL_PAGES',
        field: 'totalPages'
      });
    }
    if (props.contentType === 'flow' && !props.contentUrl) {
      throw new ValidationError('Flow content requires contentUrl', {
        code: 'MISSING_CONTENT_URL',
        field: 'contentUrl'
      });
    }

    this.contentType = props.contentType;
    this.format = props.format;
    this.totalPages = props.totalPages ?? null;
    this.contentUrl = props.contentUrl ?? null;
    this.pageLayout = props.pageLayout ?? 'single';
    this.readingDirection = props.readingDirection ?? 'ltr';
    this._getPageUrl = props._getPageUrl ?? null;
    this.manifestUrl = props.manifestUrl ?? null;
    this.resumable = props.resumable ?? true;
    this.resumePosition = props.resumePosition ?? null;
    this.audioItemId = props.audioItemId ?? null;
  }

  /**
   * Get URL for a specific page (paged content only)
   * @param {number} page - Page number (0-indexed)
   * @returns {string|null}
   */
  getPageUrl(page) {
    if (this.contentType !== 'paged' || !this._getPageUrl) {
      return null;
    }
    return this._getPageUrl(page);
  }

  /**
   * Get reading progress as percentage (0-100)
   * For paged: (currentPage / totalPages) * 100
   * For flow: resumePosition is already percent
   * @returns {number|null}
   */
  getProgress() {
    if (this.resumePosition === null || this.resumePosition === undefined) {
      return null;
    }

    if (this.contentType === 'paged' && this.totalPages) {
      return Math.round((this.resumePosition / this.totalPages) * 100);
    }

    // Flow content: resumePosition is already percent
    return this.resumePosition;
  }

  /**
   * Check if item is readable
   * @returns {boolean}
   */
  isReadable() {
    return true;
  }

  /**
   * Check if reading is complete (>= 90% progress)
   * @returns {boolean}
   */
  isComplete() {
    const progress = this.getProgress();
    return progress !== null && progress >= 90;
  }

  /**
   * Check if reading is in progress (> 0% and < 90%)
   * @returns {boolean}
   */
  isInProgress() {
    const progress = this.getProgress();
    return progress !== null && progress > 0 && progress < 90;
  }
}

export default ReadableItem;
