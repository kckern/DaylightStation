/**
 * Media Domain
 *
 * Domain entities and value objects for media operations.
 * Note: YouTubeDownloadService moved to 3_applications/media/services (uses infrastructure)
 *
 * @module domains/media
 */

export { MediaKeyResolver } from './MediaKeyResolver.mjs';
export { UnknownMediaSourceError, UnresolvableMediaKeyError, QueueFullError } from './errors.mjs';
export { isMediaSearchable, validateSearchQuery, IMediaSearchable } from './IMediaSearchable.mjs';
export { MediaQueue, ADDED_FROM } from './entities/MediaQueue.mjs';
