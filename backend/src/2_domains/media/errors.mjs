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
