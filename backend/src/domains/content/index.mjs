// backend/src/domains/content/index.mjs

// Entities
export { Item } from './entities/Item.mjs';

// Capabilities
export { ListableItem } from './capabilities/Listable.mjs';
export { PlayableItem } from './capabilities/Playable.mjs';

// Ports
export { validateAdapter, ContentSourceBase } from './ports/IContentSource.mjs';

// Services
export { ContentSourceRegistry } from './services/ContentSourceRegistry.mjs';
