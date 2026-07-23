/**
 * A bank source synthesizes question banks that are NOT files on disk.
 * SchoolService consults injected sources before the datastore, so a source
 * can serve colon-prefixed virtual ids (e.g. `geo:us-state-capitals`) that the
 * file datastore's id regex rejects.
 *
 * Implementations provide:
 *   resolve(bankId): rawBank | null        // null => not mine / unopenable
 *   listDeckSummaries(): Array<{ deckId, bankId, title, itemType, available }>
 */
export const IBankSource = Symbol('IBankSource');
