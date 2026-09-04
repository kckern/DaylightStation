/**
 * Bridge fitness configuration values into a FitnessSession instance.
 * Centralizes the wiring so it is unit-testable and reusable across
 * config-reload paths.
 */

import getLogger from '../lib/logging/Logger.js';

const appliedCatalogs = new WeakMap();

export function equipmentCatalogIdentity(list = []) {
  const encoded = JSON.stringify(list.map(item => ({
    id: item?.id, type: item?.type,
    matId: item?.pressure_mat || item?.pressureMat || item?.sensor?.pressure_mat || null,
    activity: item?.activity || null,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  let hash = 2166136261;
  for (let i = 0; i < encoded.length; i++) hash = Math.imul(hash ^ encoded.charCodeAt(i), 16777619);
  return `equipment-${(hash >>> 0).toString(16)}`;
}

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
  const identity = equipmentCatalogIdentity(list);
  if (appliedCatalogs.get(session) !== identity) {
    appliedCatalogs.set(session, identity);
    getLogger().info('fitness.equipment.catalog_applied', {
      identity, equipmentCount: list.length,
      pressureMatBindings: list.filter(item => item?.pressure_mat || item?.pressureMat || item?.sensor?.pressure_mat)
        .map(item => ({ equipmentId: item.id, matId: item.pressure_mat || item.pressureMat || item.sensor.pressure_mat })),
    });
  }
}
