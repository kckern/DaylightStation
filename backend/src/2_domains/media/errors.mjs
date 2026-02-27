import { DomainInvariantError } from '#domains/core/errors/index.mjs';

/**
 * Error thrown when a media key uses an unrecognized source prefix.
 *
 * @class UnknownMediaSourceError
 * @extends Error
 */
export class UnknownMediaSourceError extends Error {
  constructor(source, knownSources = []) {
    super(`Unknown media source: '${source}'. Known sources: ${knownSources.join(', ')}`);
    this.name = 'UnknownMediaSourceError';
    this.source = source;
    this.knownSources = knownSources;
  }
}

/**
 * Error thrown when a media key cannot be resolved in the given context.
 *
 * @class UnresolvableMediaKeyError
 * @extends Error
 */
export class UnresolvableMediaKeyError extends Error {
  constructor(key, appContext) {
    super(`Cannot resolve media key: '${key}' in context '${appContext || 'default'}'`);
    this.name = 'UnresolvableMediaKeyError';
    this.key = key;
    this.appContext = appContext;
  }
}

/**
 * Error thrown when attempting to add items beyond the queue capacity.
 *
 * @class QueueFullError
 * @extends DomainInvariantError
 */
export class QueueFullError extends DomainInvariantError {
  constructor(currentSize, maxSize = 500) {
    super(`Queue is full: ${currentSize}/${maxSize} items`, { code: 'QUEUE_FULL' });
    this.name = 'QueueFullError';
    this.currentSize = currentSize;
    this.maxSize = maxSize;
  }
}
