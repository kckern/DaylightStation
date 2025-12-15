/**
 * Attachment value object
 * @module domain/value-objects/Attachment
 * 
 * Represents a media attachment (photo, voice, document, etc.)
 * that can be associated with a message.
 */

import { ValidationError } from '../../_lib/errors/index.mjs';

/**
 * Attachment types enum
 */
export const AttachmentType = {
  PHOTO: 'photo',
  VOICE: 'voice',
  AUDIO: 'audio',
  VIDEO: 'video',
  DOCUMENT: 'document',
  STICKER: 'sticker',
};

/**
 * Attachment value object
 * Immutable representation of a media attachment
 */
export class Attachment {
  #type;
  #fileId;
  #url;
  #localPath;
  #buffer;
  #mimeType;
  #fileName;
  #fileSize;
  #width;
  #height;
  #duration;
  #thumbnail;
  #metadata;

  /**
   * @param {Object} props
   * @param {string} props.type - Attachment type (photo, voice, etc.)
   * @param {string} [props.fileId] - Remote file ID (e.g., Telegram file_id)
   * @param {string} [props.url] - URL to the file
   * @param {string} [props.localPath] - Local file path
   * @param {Buffer} [props.buffer] - File buffer
   * @param {string} [props.mimeType] - MIME type
   * @param {string} [props.fileName] - Original filename
   * @param {number} [props.fileSize] - File size in bytes
   * @param {number} [props.width] - Width (for images/videos)
   * @param {number} [props.height] - Height (for images/videos)
   * @param {number} [props.duration] - Duration in seconds (for audio/video)
   * @param {Object} [props.thumbnail] - Thumbnail data
   * @param {Object} [props.metadata] - Additional metadata
   */
  constructor(props) {
    if (!props.type || !Object.values(AttachmentType).includes(props.type)) {
      throw new ValidationError('Invalid attachment type', { type: props.type });
    }

    // At least one source is required
    if (!props.fileId && !props.url && !props.localPath && !props.buffer) {
      throw new ValidationError('Attachment must have fileId, url, localPath, or buffer');
    }

    this.#type = props.type;
    this.#fileId = props.fileId || null;
    this.#url = props.url || null;
    this.#localPath = props.localPath || null;
    this.#buffer = props.buffer || null;
    this.#mimeType = props.mimeType || null;
    this.#fileName = props.fileName || null;
    this.#fileSize = props.fileSize || null;
    this.#width = props.width || null;
    this.#height = props.height || null;
    this.#duration = props.duration || null;
    this.#thumbnail = props.thumbnail ? Object.freeze({ ...props.thumbnail }) : null;
    this.#metadata = props.metadata ? Object.freeze({ ...props.metadata }) : null;

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get type() { return this.#type; }
  get fileId() { return this.#fileId; }
  get url() { return this.#url; }
  get localPath() { return this.#localPath; }
  get buffer() { return this.#buffer; }
  get mimeType() { return this.#mimeType; }
  get fileName() { return this.#fileName; }
  get fileSize() { return this.#fileSize; }
  get width() { return this.#width; }
  get height() { return this.#height; }
  get duration() { return this.#duration; }
  get thumbnail() { return this.#thumbnail; }
  get metadata() { return this.#metadata; }

  // ==================== Type Checks ====================

  get isPhoto() { return this.#type === AttachmentType.PHOTO; }
  get isVoice() { return this.#type === AttachmentType.VOICE; }
  get isAudio() { return this.#type === AttachmentType.AUDIO; }
  get isVideo() { return this.#type === AttachmentType.VIDEO; }
  get isDocument() { return this.#type === AttachmentType.DOCUMENT; }

  // ==================== Source Helpers ====================

  /**
   * Check if attachment has a remote source
   */
  get hasRemoteSource() {
    return !!this.#fileId || !!this.#url;
  }

  /**
   * Check if attachment has a local source
   */
  get hasLocalSource() {
    return !!this.#localPath || !!this.#buffer;
  }

  /**
   * Get the best available source identifier
   */
  get source() {
    return this.#fileId || this.#url || this.#localPath || '[buffer]';
  }

  // ==================== Serialization ====================

  toJSON() {
    const json = { type: this.#type };
    
    if (this.#fileId) json.fileId = this.#fileId;
    if (this.#url) json.url = this.#url;
    if (this.#localPath) json.localPath = this.#localPath;
    // Don't serialize buffer to JSON
    if (this.#mimeType) json.mimeType = this.#mimeType;
    if (this.#fileName) json.fileName = this.#fileName;
    if (this.#fileSize) json.fileSize = this.#fileSize;
    if (this.#width) json.width = this.#width;
    if (this.#height) json.height = this.#height;
    if (this.#duration) json.duration = this.#duration;
    if (this.#thumbnail) json.thumbnail = this.#thumbnail;
    if (this.#metadata) json.metadata = this.#metadata;

    return json;
  }

  // ==================== Factory Methods ====================

  /**
   * Create from plain object
   */
  static from(data) {
    if (data instanceof Attachment) return data;
    return new Attachment(data);
  }

  /**
   * Create a photo attachment
   */
  static photo(props) {
    return new Attachment({ ...props, type: AttachmentType.PHOTO });
  }

  /**
   * Create a voice attachment
   */
  static voice(props) {
    return new Attachment({ ...props, type: AttachmentType.VOICE });
  }

  /**
   * Create an audio attachment
   */
  static audio(props) {
    return new Attachment({ ...props, type: AttachmentType.AUDIO });
  }

  /**
   * Create a video attachment
   */
  static video(props) {
    return new Attachment({ ...props, type: AttachmentType.VIDEO });
  }

  /**
   * Create a document attachment
   */
  static document(props) {
    return new Attachment({ ...props, type: AttachmentType.DOCUMENT });
  }

  /**
   * Create from Telegram photo array (picks best resolution)
   * @param {Array} photoSizes - Telegram PhotoSize array
   */
  static fromTelegramPhoto(photoSizes) {
    if (!Array.isArray(photoSizes) || photoSizes.length === 0) {
      throw new ValidationError('Invalid Telegram photo array');
    }

    // Get the largest photo
    const photo = photoSizes.reduce((best, current) => {
      const bestSize = (best.width || 0) * (best.height || 0);
      const currentSize = (current.width || 0) * (current.height || 0);
      return currentSize > bestSize ? current : best;
    });

    // Get smallest for thumbnail
    const thumb = photoSizes.reduce((smallest, current) => {
      const smallestSize = (smallest.width || 0) * (smallest.height || 0);
      const currentSize = (current.width || 0) * (current.height || 0);
      return currentSize < smallestSize ? current : smallest;
    });

    return new Attachment({
      type: AttachmentType.PHOTO,
      fileId: photo.file_id,
      width: photo.width,
      height: photo.height,
      fileSize: photo.file_size,
      thumbnail: thumb.file_id !== photo.file_id ? {
        fileId: thumb.file_id,
        width: thumb.width,
        height: thumb.height,
      } : null,
    });
  }

  /**
   * Create from Telegram voice message
   * @param {Object} voice - Telegram Voice object
   */
  static fromTelegramVoice(voice) {
    return new Attachment({
      type: AttachmentType.VOICE,
      fileId: voice.file_id,
      duration: voice.duration,
      mimeType: voice.mime_type,
      fileSize: voice.file_size,
    });
  }

  /**
   * Create from Telegram audio message
   * @param {Object} audio - Telegram Audio object
   */
  static fromTelegramAudio(audio) {
    return new Attachment({
      type: AttachmentType.AUDIO,
      fileId: audio.file_id,
      duration: audio.duration,
      mimeType: audio.mime_type,
      fileSize: audio.file_size,
      fileName: audio.file_name,
      metadata: {
        performer: audio.performer,
        title: audio.title,
      },
    });
  }
}

export default Attachment;
