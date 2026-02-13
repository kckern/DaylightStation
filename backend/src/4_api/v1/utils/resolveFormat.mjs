/**
 * Re-export from domain layer.
 * resolveFormat is pure domain logic (no HTTP deps) and now lives in
 * #domains/content/utils/resolveFormat.mjs.
 *
 * This shim keeps existing 4_api consumers working without import changes.
 */
export { resolveFormat } from '#domains/content/utils/resolveFormat.mjs';
