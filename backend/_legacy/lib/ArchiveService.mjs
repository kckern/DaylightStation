/**
 * DEPRECATED: Legacy Archive Service Re-export Shim
 *
 * This module re-exports from the new location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/3_applications/content/services/ArchiveService.mjs
 *
 * This shim will be removed in a future release.
 */

console.warn(
  '[DEPRECATION] Importing from #backend/_legacy/lib/ArchiveService.mjs is deprecated.\n' +
  'Update imports to: #backend/src/3_applications/content/services/ArchiveService.mjs'
);

export {
  getConfig,
  isArchiveEnabled,
  getHotData,
  getMostRecentTimestamp,
  saveToHot,
  loadArchive,
  saveToArchive,
  appendToArchive,
  getDataForDateRange,
  rotateToArchive,
  migrateToHotCold,
  listArchiveYears,
  getArchiveStatus,
  clearConfigCache
} from '../../src/3_applications/content/services/ArchiveService.mjs';

export { default } from '../../src/3_applications/content/services/ArchiveService.mjs';
