/**
 * Media Application
 *
 * Handles media operations like video downloads from various sources.
 *
 * @module applications/media
 */

// Job handlers
export { createFreshVideoJobHandler } from './FreshVideoJobHandler.mjs';

// Application services
export { FreshVideoService } from './services/FreshVideoService.mjs';
export { MediaDownloadService } from './services/MediaDownloadService.mjs';
export { MediaJobExecutor } from './MediaJobExecutor.mjs';
export { GetContentMediaResource } from './usecases/GetContentMediaResource.mjs';
export { GetLocalMediaResource } from './usecases/GetLocalMediaResource.mjs';
export { GetLocalMediaThumbnail } from './usecases/GetLocalMediaThumbnail.mjs';

// Ports (interfaces)
export { IContentMediaRepository, isContentMediaRepository } from './ports/IContentMediaRepository.mjs';
export { ILocalMediaRepository, isLocalMediaRepository } from './ports/ILocalMediaRepository.mjs';
export { IVideoSourceGateway, isVideoSourceGateway } from './ports/IVideoSourceGateway.mjs';
