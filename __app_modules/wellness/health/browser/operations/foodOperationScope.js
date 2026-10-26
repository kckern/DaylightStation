const idOf = row => String(row.uuid ?? row.id);
/** Includes actual group dependencies; an unrelated meal sibling is never reserved. */
export function foodOperationScope({ action, rows = [], selectedIds = [], groupId, destinationGroupId }) {
  const all = new Map();
  const visit = row => { all.set(idOf(row), row); (row.children || []).forEach(visit); };
  rows.forEach(visit);
  const ids = new Set([...selectedIds, groupId, destinationGroupId].filter(id => id != null).map(String));
  if (action === 'membership') {
    for (const id of [...ids]) { const parent = all.get(id)?.parentId; if (parent != null) ids.add(String(parent)); }
  }
  // Transitive descendants, including nested group membership.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, row] of all) if (row.parentId != null && ids.has(String(row.parentId)) && !ids.has(id)) {
      ids.add(id); changed = true;
    }
    for (const id of [...ids]) for (const child of all.get(id)?.children || []) if (!ids.has(idOf(child))) {
      ids.add(idOf(child)); changed = true;
    }
  }
  return [...ids].sort();
}
