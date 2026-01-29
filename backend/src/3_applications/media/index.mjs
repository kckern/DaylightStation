/**
 * Media Application
 *
 * Handles media operations like video downloads from various sources.
 *
 * @module applications/media
 */

// Job handlers
export { createFreshVideoJobHandler, createYouTubeJobHandler } from './YouTubeJobHandler.mjs';

// Application services
export { FreshVideoService } from './services/FreshVideoService.mjs';
export { MediaJobExecutor } from './MediaJobExecutor.mjs';

// Ports (interfaces)
export { IVideoSourceGateway, isVideoSourceGateway } from './ports/IVideoSourceGateway.mjs';

// Legacy exports (deprecated - will be removed in future version)
export { YouTubeDownloadService } from './services/YouTubeDownloadService.mjs';
