/**
 * Bridge fitness configuration values into a FitnessSession instance.
 * Centralizes the wiring so it is unit-testable and reusable across
 * config-reload paths.
 */

/**
 * Apply equipment catalog from a fitness config object onto a session.
 * Reads `config.fitness.equipment` first, falls back to `config.equipment`.
 * Empty/missing values clear the catalog rather than leaving stale data.
 */
export function applyEquipmentCatalogFromConfig(session, config) {
  if (!session?.setEquipmentCatalog) return;
  const root = config?.fitness || config || {};
  const list = Array.isArray(root.equipment) ? root.equipment : [];
  session.setEquipmentCatalog(list);
}
