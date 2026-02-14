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

// Ports (interfaces)
export { IVideoSourceGateway, isVideoSourceGateway } from './ports/IVideoSourceGateway.mjs';
