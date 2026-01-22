/**
 * Infinity - Legacy Re-export Shim
 *
 * This module re-exports from the new domain location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/1_domains/finance/services/InfinityClient.mjs
 *
 * This shim will be removed in a future release.
 */

export {
  loadTable,
  saveItem,
  updateItem,
  loadData,
  loadFolders,
  processTable,
  saveImages,
  checkForDupeImages,
  keys
} from '../../src/1_domains/finance/services/InfinityClient.mjs';

export { default } from '../../src/1_domains/finance/services/InfinityClient.mjs';
