/**
 * StreamProfile Value Object - A site profile for resolving online streams.
 * @module domains/content/value-objects/StreamProfile
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { isStreamFormat, isStreamStrategy } from './StreamFormat.mjs';

/**
 * A site profile loaded from data/system/config/streaming/<name>.yml.
 * Holds only data + a pure matches() predicate. No site logic.
 */
export class StreamProfile {
  constructor(raw = {}) {
    const { name, match = {}, strategy, format } = raw;
    if (!name) {
      throw new ValidationError('StreamProfile requires name', { field: 'name' });
    }
    if (!isStreamStrategy(strategy)) {
      throw new ValidationError(`Invalid strategy: ${strategy}`, { field: 'strategy' });
    }
    if (!isStreamFormat(format)) {
      throw new ValidationError(`Invalid format: ${format}`, { field: 'format' });
    }
    this.name = name;
    this.strategy = strategy;
    this.format = format;
    this.hosts = (match.hosts || []).map((h) => String(h).toLowerCase().replace(/^www\./, ''));
    this.urlRegex = match.urlRegex ? new RegExp(match.urlRegex) : null;
    this.raw = raw;
    Object.freeze(this);
  }

  matches(url) {
    try {
      if (this.urlRegex && this.urlRegex.test(url)) return true;
      if (this.hosts.length) {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return this.hosts.includes(host);
      }
    } catch { /* invalid URL → no match */ }
    return false;
  }
}
