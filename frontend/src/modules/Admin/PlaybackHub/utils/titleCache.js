/**
 * Module-level shared cache for LabeledContentPicker title resolution.
 *
 * Many picker instances render concurrently on the playback-hub admin
 * (one per transport row + one per schedule window + one per scheduled
 * fire). Each picker resolves its content title via `/api/v1/info/:source/:id`.
 * Without a shared cache, each instance would refetch independently.
 *
 * This cache:
 *   - is keyed by the full "source:id" content ID string,
 *   - stores the resolved title (string),
 *   - survives component unmount (module-scope Map),
 *   - is cleared only on full page reload.
 *
 * Cross-tab invalidation is intentionally NOT implemented — admin sees
 * stale titles until next reload. Acceptable for one-household use.
 */
export const titleCache = new Map();
