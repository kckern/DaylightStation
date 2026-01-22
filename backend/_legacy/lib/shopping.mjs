/**
 * Shopping - Legacy Re-export Shim
 *
 * This module re-exports from the new domain location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/1_domains/finance/services/ShoppingHarvester.mjs
 *
 * This shim will be removed in a future release.
 */

export {
  loadShoppingConfig,
  buildReceiptQuery,
  parseEmailContent,
  identifyRetailer,
  extractReceiptData,
  generateReceiptId,
  mergeReceipts,
  formatLocalTimestamp
} from '../../src/1_domains/finance/services/ShoppingHarvester.mjs';

export { default } from '../../src/1_domains/finance/services/ShoppingHarvester.mjs';
