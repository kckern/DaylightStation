/**
 * StreamResult Value Object - Normalized output of any IStreamResolver.
 * @module domains/content/value-objects/StreamResult
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { STREAM_FORMATS } from './StreamFormat.mjs';

/**
 * Normalized output of any IStreamResolver. Immutable.
 */
export class StreamResult {
  constructor({ format, mediaUrl, title = null, poster = null, duration = null, headers = null }) {
    if (!STREAM_FORMATS.has(format)) {
      throw new ValidationError(`Invalid stream format: ${format}`, { field: 'format' });
    }
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      throw new ValidationError('StreamResult requires mediaUrl', { field: 'mediaUrl' });
    }
    this.format = format;
    this.mediaUrl = mediaUrl;
    this.title = title;
    this.poster = poster;
    this.duration = duration;
    this.headers = headers;
    Object.freeze(this);
  }
}
