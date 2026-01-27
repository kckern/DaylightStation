/**
 * Journaling Domain
 */

// Entities
export { JournalEntry } from './entities/JournalEntry.mjs';

// Ports moved to application layer - re-export for backward compatibility
export { IJournalDatastore } from '#apps/journaling/ports/IJournalDatastore.mjs';

// Services
export { JournalService } from './services/JournalService.mjs';
