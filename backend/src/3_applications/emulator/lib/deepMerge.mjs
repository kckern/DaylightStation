// Re-export of the single deep-merge SSOT (#system/utils/deepMerge.mjs).
// Kept as a thin shim so existing emulator imports of './deepMerge.mjs'
// continue to resolve.
export { deepMerge, default } from '#system/utils/deepMerge.mjs';
