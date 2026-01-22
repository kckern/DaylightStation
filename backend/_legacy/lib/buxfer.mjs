/**
 * Buxfer - Legacy Re-export Shim
 *
 * This module re-exports from the new domain location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/1_domains/finance/services/BuxferClient.mjs
 *
 * This shim will be removed in a future release.
 */

export {
  getTransactions,
  deleteTransactions,
  deleteTransaction,
  processMortgageTransactions,
  getAccountBalances,
  processTransactions,
  updateTransaction,
  addTransaction
} from '../../src/1_domains/finance/services/BuxferClient.mjs';

export { default } from '../../src/1_domains/finance/services/BuxferClient.mjs';
