// backend/src/domains/content/index.mjs

// Entities
export { Item } from './entities/Item.mjs';
export { WatchState } from './entities/WatchState.mjs';

// Capabilities
export { ListableItem } from './capabilities/Listable.mjs';
export { PlayableItem } from './capabilities/Playable.mjs';
export { QueueableItem } from './capabilities/Queueable.mjs';

// Ports
export { validateAdapter, ContentSourceBase } from './ports/IContentSource.mjs';

// Services
export { ContentSourceRegistry } from './services/ContentSourceRegistry.mjs';
export { MediaMemoryValidatorService } from './services/MediaMemoryValidatorService.mjs';
export {
  getMediaMemoryPath,
  getMediaMemoryDir,
  parseLibraryFilename,
  buildLibraryFilename,
  getMediaMemoryFiles
} from './services/MediaMemoryService.mjs';
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
