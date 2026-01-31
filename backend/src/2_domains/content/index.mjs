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
export { ReadableItem } from './capabilities/Readable.mjs';
export { ViewableItem } from './capabilities/Viewable.mjs';
export {
  createVisualTrack,
  createAudioTrack,
  createComposedPresentation
} from './capabilities/Composable.mjs';

// Services
export { ContentSourceRegistry } from './services/ContentSourceRegistry.mjs';
export { MediaMemoryValidatorService } from './services/MediaMemoryValidatorService.mjs';
export { IMediaProgressClassifier } from './services/IMediaProgressClassifier.mjs';
export { DefaultMediaProgressClassifier } from './services/DefaultMediaProgressClassifier.mjs';
