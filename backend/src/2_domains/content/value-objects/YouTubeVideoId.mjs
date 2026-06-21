/**
 * YouTubeVideoId Value Object — a YouTube video identifier.
 * @module domains/content/value-objects/YouTubeVideoId
 *
 * Published-language identity for the `youtube:` content source. An id is an
 * opaque 11-char token (`[A-Za-z0-9_-]{11}`) with no slashes or query string,
 * so `youtube:<id>` survives Express path routing intact — unlike a raw
 * `stream:https://…?v=…` URL, whose `//` and query are mangled before any
 * resolver sees them.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export class YouTubeVideoId {
  #value;

  constructor(value) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      throw new ValidationError('Invalid YouTube video id', {
        code: 'INVALID_YOUTUBE_VIDEO_ID',
        field: 'videoId',
        value,
      });
    }
    this.#value = value;
    Object.freeze(this);
  }

  get value() { return this.#value; }

  toString() { return this.#value; }

  get watchUrl() { return `https://www.youtube.com/watch?v=${this.#value}`; }

  get embedUrl() { return `https://www.youtube.com/embed/${this.#value}?autoplay=1`; }

  equals(other) { return other instanceof YouTubeVideoId && other.value === this.#value; }
}

export default YouTubeVideoId;
