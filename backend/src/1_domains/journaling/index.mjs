/**
 * Journaling Domain
 */

// Entities
export { JournalEntry } from './entities/JournalEntry.mjs';

// Ports moved to application layer - re-export for backward compatibility
export { IJournalStore } from '../../3_applications/journaling/ports/IJournalStore.mjs';

// Services
export { JournalService } from './services/JournalService.mjs';
