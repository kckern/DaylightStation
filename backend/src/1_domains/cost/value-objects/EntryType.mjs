/**
 * EntryType Enum - Cost entry type classification
 * @module domains/cost/value-objects/EntryType
 *
 * Defines the types of cost entries that can be tracked:
 * - USAGE: Variable costs based on consumption (e.g., API calls, electricity)
 * - SUBSCRIPTION: Recurring fixed costs (e.g., monthly services)
 * - PURCHASE: One-time purchases (e.g., equipment, licenses)
 * - TRANSACTION: Money movement that doesn't count as spend (e.g., transfers)
 *
 * @example
 * import { EntryType, isCountedInSpend } from '#domains/cost';
 * const type = EntryType.USAGE;
 * if (isCountedInSpend(type)) {
 *   // Include in budget calculations
 * }
 */

/**
 * Cost entry type enum
 *
 * @enum {string}
 */
export const EntryType = Object.freeze({
  /** Variable costs based on consumption (API calls, electricity, etc.) */
  USAGE: 'usage',

  /** Recurring fixed costs (monthly services, subscriptions) */
  SUBSCRIPTION: 'subscription',

  /** One-time purchases (equipment, licenses, etc.) */
  PURCHASE: 'purchase',

  /** Money movement that doesn't count as spend (transfers, refunds) */
  TRANSACTION: 'transaction'
});

/**
 * Array of all valid entry type values
 * @type {readonly string[]}
 */
export const ENTRY_TYPES = Object.freeze(Object.values(EntryType));

/**
 * Check if an entry type is counted in spend calculations
 *
 * Usage, subscription, and purchase entries count toward spend.
 * Transaction entries (transfers, refunds) do not count.
 *
 * @param {string} entryType - Entry type to check
 * @returns {boolean} True if type counts toward spend
 */
export function isCountedInSpend(entryType) {
  return entryType === EntryType.USAGE ||
         entryType === EntryType.SUBSCRIPTION ||
         entryType === EntryType.PURCHASE;
}
