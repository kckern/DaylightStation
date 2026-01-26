// backend/src/domains/content/index.mjs
//
// Note: ArchiveService and MediaMemoryService moved to 3_applications/content/services
// (they use infrastructure like fs, config services)

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
