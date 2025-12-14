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
    'save', 'findById', 'findAll', 'update', 'delete', 'exists',
    // Extended
    'findByDateRange', 'findByDate', 'findRecent', 'getMessageHistory', 'aggregateByDate',
  ],
};

export default IJournalEntryRepository;
