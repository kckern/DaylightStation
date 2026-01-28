// backend/src/domains/content/index.mjs
//
// Note: ArchiveService and MediaMemoryService moved to 3_applications/content/services
// (they use infrastructure like fs, config services)

// Value Objects
export { ItemId } from './value-objects/index.mjs';

// Entities
export { Item } from './entities/Item.mjs';
export { MediaProgress } from './entities/MediaProgress.mjs';

// Capabilities
export { ListableItem } from './capabilities/Listable.mjs';
export { PlayableItem } from './capabilities/Playable.mjs';
export { QueueableItem } from './capabilities/Queueable.mjs';

// Ports moved to application layer - re-export for backward compatibility
export { validateAdapter, ContentSourceBase } from '#apps/content/ports/IContentSource.mjs';

// Services
export { ContentSourceRegistry } from './services/ContentSourceRegistry.mjs';
export { MediaMemoryValidatorService } from './services/MediaMemoryValidatorService.mjs';
