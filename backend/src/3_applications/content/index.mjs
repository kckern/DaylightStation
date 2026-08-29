/**
 * Content Application
 *
 * Application-layer services for content management.
 * These services use infrastructure (fs, config services) and don't belong in the domain layer.
 *
 * @module applications/content
 */

// ArchiveService - Hot/Cold storage management
export {
  getConfig as getArchiveConfig,
  isArchiveEnabled,
  getHotData,
  getMostRecentTimestamp,
  saveToHot,
  loadArchive,
  saveToArchive,
  appendToArchive,
  getDataForDateRange,
  rotateToArchive,
  migrateToHotCold,
  listArchiveYears,
  getArchiveStatus,
  clearConfigCache as clearArchiveConfigCache
} from './services/ArchiveService.mjs';
export { default as ArchiveService } from './services/ArchiveService.mjs';

// ContentQueryService - Multi-source content query orchestration
export { ContentQueryService } from './ContentQueryService.mjs';
export { default as ContentQueryServiceDefault } from './ContentQueryService.mjs';
