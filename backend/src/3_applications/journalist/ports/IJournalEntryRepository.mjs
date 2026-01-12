/**
 * IJournalEntryRepository Port
 * @module journalist/application/ports/IJournalEntryRepository
 *
 * Repository for journal entries with extended query methods.
 */

/**
 * @interface IJournalEntryRepository
 * @extends IRepository<JournalEntry>
 */

/**
 * Save a journal entry
 * @function
 * @name IJournalEntryRepository#save
 * @param {JournalEntry} entry
 * @returns {Promise<JournalEntry>}
 */

/**
 * Find entry by ID
 * @function
 * @name IJournalEntryRepository#findById
 * @param {string} uuid
 * @returns {Promise<JournalEntry|null>}
 */

/**
 * Find all entries for a chat
 * @function
 * @name IJournalEntryRepository#findAll
 * @param {string} chatId
 * @returns {Promise<JournalEntry[]>}
 */

/**
 * Update an entry
 * @function
 * @name IJournalEntryRepository#update
 * @param {JournalEntry} entry
 * @returns {Promise<JournalEntry>}
 */

/**
 * Delete an entry
 * @function
 * @name IJournalEntryRepository#delete
 * @param {string} uuid
 * @returns {Promise<void>}
 */

/**
 * Check if entry exists
 * @function
 * @name IJournalEntryRepository#exists
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */

/**
 * Find entries by date range
 * @function
 * @name IJournalEntryRepository#findByDateRange
 * @param {string} chatId
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<JournalEntry[]>}
 */

/**
 * Find entries by date
 * @function
 * @name IJournalEntryRepository#findByDate
 * @param {string} chatId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<JournalEntry[]>}
 */

/**
 * Find recent entries
 * @function
 * @name IJournalEntryRepository#findRecent
 * @param {string} chatId
 * @param {number} days - Number of days to look back
 * @returns {Promise<JournalEntry[]>}
 */

/**
 * Get message history
 * @function
 * @name IJournalEntryRepository#getMessageHistory
 * @param {string} chatId
 * @param {number} limit - Max messages to return
 * @returns {Promise<ConversationMessage[]>}
 */

/**
 * Aggregate entries by date
 * @function
 * @name IJournalEntryRepository#aggregateByDate
 * @param {string} chatId
 * @param {string} startDate - YYYY-MM-DD
 * @returns {Promise<Array<{date: string, entries: JournalEntry[]}>>}
 */

// Export interface documentation
export const IJournalEntryRepository = {
  name: 'IJournalEntryRepository',
  methods: [
    // From IRepository
    'save',
    'findById',
    'findAll',
    'update',
    'delete',
    'exists',
    // Extended
    'findByDateRange',
    'findByDate',
    'findRecent',
    'getMessageHistory',
    'aggregateByDate',
  ],
};

export default IJournalEntryRepository;
