const idOf = row => String(row.uuid ?? row.id);
/** Includes actual group dependencies; an unrelated meal sibling is never reserved. */
export function foodOperationScope({ action, rows = [], selectedIds = [], groupId, destinationGroupId }) {
  const all = new Map();
  const aliases = new Map();
  const visit = row => {
    const id = idOf(row); all.set(id, row);
    if (row.id != null) aliases.set(String(row.id), id);
    aliases.set(id, id);
    (row.children || []).forEach(visit);
  };
  const canonical = id => aliases.get(String(id)) || String(id);
  rows.forEach(visit);
  const ids = new Set([...selectedIds, groupId, destinationGroupId].filter(id => id != null).map(canonical));
  if (['membership', 'group', 'groups', 'ungroup', 'amend'].includes(action)) {
    for (const id of [...ids]) { const parent = all.get(id)?.parentId; if (parent != null) ids.add(canonical(parent)); }
  }
  // Transitive descendants, including nested group membership.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, row] of all) if (row.parentId != null && ids.has(canonical(row.parentId)) && !ids.has(id)) {
      ids.add(id); changed = true;
    }
    for (const id of [...ids]) for (const child of all.get(id)?.children || []) if (!ids.has(idOf(child))) {
      ids.add(idOf(child)); changed = true;
    }
  }
  return [...ids].sort();
}
