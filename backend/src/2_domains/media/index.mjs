/**
 * Media Domain
 *
 * Domain entities and value objects for media operations.
 * Note: YouTubeDownloadService moved to 3_applications/media/services (uses infrastructure)
 *
 * @module domains/media
 */

export { MediaKeyResolver } from './MediaKeyResolver.mjs';
export { UnknownMediaSourceError, UnresolvableMediaKeyError } from './errors.mjs';
export { isMediaSearchable, validateSearchQuery, IMediaSearchable } from './IMediaSearchable.mjs';
