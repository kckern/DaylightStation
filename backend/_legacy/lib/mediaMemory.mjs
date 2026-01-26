/**
 * DEPRECATED: Legacy Media Memory Re-export Shim
 *
 * This module re-exports from the new location for backwards compatibility.
 * All new code should import from:
 *   #backend/src/3_applications/content/services/MediaMemoryService.mjs
 *
 * YAML sanitization functions have been moved to:
 *   #backend/src/0_infrastructure/utils/yamlSanitizer.mjs
 *
 * This shim will be removed in a future release.
 */

console.warn(
  '[DEPRECATION] Importing from #backend/_legacy/lib/mediaMemory.mjs is deprecated.\n' +
  'Update imports to: #backend/src/3_applications/content/services/MediaMemoryService.mjs'
);

export {
  getMediaMemoryPath,
  getMediaMemoryDir,
  parseLibraryFilename,
  buildLibraryFilename,
  getMediaMemoryFiles,
  // Re-exported from infrastructure for backwards compat
  sanitizeForYAML,
  sanitizeObjectForYAML
} from '../../src/3_applications/content/services/MediaMemoryService.mjs';

export { default } from '../../src/3_applications/content/services/MediaMemoryService.mjs';
