// backend/src/domains/content/index.mjs
//
// Note: ArchiveService lives in applications; media-memory filesystem helpers live in system/media.
// (they use infrastructure like fs, config services)

// Value Objects
export { ItemId } from './value-objects/index.mjs';
export {
  ContentCategory,
  ALL_CONTENT_CATEGORIES,
  isValidContentCategory,
  getCategoryScore
} from './value-objects/index.mjs';

// Entities
export { Item } from './entities/Item.mjs';
export { MediaProgress } from './entities/MediaProgress.mjs';

// Capabilities
export { DisplayableItem } from './capabilities/Displayable.mjs';
export { ListableItem } from './capabilities/Listable.mjs';
export { PlayableItem } from './capabilities/Playable.mjs';
export { QueueableItem } from './capabilities/Queueable.mjs';
export { ReadableItem } from './capabilities/Readable.mjs';
export {
  createVisualTrack,
  createAudioTrack,
  createComposedPresentation
} from './capabilities/Composable.mjs';

// Services
export { CanvasSelectionService } from './services/CanvasSelectionService.mjs';
export { ItemSelectionService } from './services/ItemSelectionService.mjs';
export { MediaProgressClassificationStrategy } from './services/MediaProgressClassificationStrategy.mjs';
export { DefaultMediaProgressClassifier } from './services/DefaultMediaProgressClassifier.mjs';
export { RelevanceScoringService } from './services/RelevanceScoringService.mjs';
