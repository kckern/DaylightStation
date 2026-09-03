// Pure transform: flat day rows -> top-level entries with attached children.
//
// A GROUP ROW CARRIES ZERO NUTRITION BY DESIGN (see LogTable.jsx). Totals
// live on its children, so `rollup` here is the thing the UI actually shows
// for a group ("Spaghetti — 640 kcal"), computed by summing the children,
// never the group row's own (zero) fields.
//
// id-vs-uuid: rows in this codebase carry both `id` and `uuid`, and which
// one is populated as a `parentId` target varies by write path. A child is
// matched to its parent when `child.parentId` equals EITHER the parent's
// `id` OR its `uuid` — matching only one silently orphans children written
// via the other path.
//
// Orphans (a `parentId` that matches no row in this set) are NOT dropped —
// they render as top-level rows, same as an ordinary childless item.
//
// Deeper nesting (a child that is itself a group, with its own children) is
// flattened to one layer under the topmost group: every descendant appears
// in `children`, in original row order, with no recursive nesting in the
// output shape. This mirrors the UI requirement (PRD F2.4) of a single
// indent level regardless of how deep the source data nests.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function groupRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];

  // Look up a row by either identifier it might be referenced by. If a
  // child's parentId happens to collide across rows — matching one row's
  // `id` and a different row's `uuid` — the later-indexed row wins (last
  // write into the map). Not expected in practice (ids/uuids are meant to
  // be unique within a day), but worth naming since it's otherwise silent.
  const byKey = new Map();
  for (const row of list) {
    if (row.id != null) byKey.set(String(row.id), row);
    if (row.uuid != null) byKey.set(String(row.uuid), row);
  }

  // Resolve each row's parent WITHIN this set — a parentId that doesn't
  // resolve here makes the row an orphan (top-level), not a dropped child.
  const rawParentOf = new Map();
  for (const row of list) {
    if (row.parentId == null) continue;
    const parent = byKey.get(String(row.parentId));
    if (parent && parent !== row) rawParentOf.set(row, parent);
  }

  // A parentId CYCLE (A -> B -> A, or longer) must never make every member
  // vanish. Without this guard, each row in the cycle has a `parentOf`
  // entry, so `isTopLevel` is false for all of them and none is ever a
  // descendant of a genuine top-level row either — `list.filter(isTopLevel)`
  // silently drops the whole cycle. Treat a cyclic parent link the same way
  // an unresolvable one is already treated: unresolvable, so the row falls
  // back to rendering top-level. This guarantees the invariant that matters
  // — every input row appears exactly once in the output, as a top-level
  // entry or as exactly one parent's child — holds even for malformed data.
  const isInCycle = (row) => {
    let cur = rawParentOf.get(row);
    let steps = 0;
    while (cur) {
      if (cur === row) return true;
      if (++steps > list.length) return false; // defensive; unreachable without a cycle
      cur = rawParentOf.get(cur);
    }
    return false;
  };

  const parentOf = new Map();
  for (const [row, parent] of rawParentOf) {
    if (!isInCycle(row)) parentOf.set(row, parent);
  }

  const directChildrenOf = new Map();
  for (const row of list) {
    const parent = parentOf.get(row);
    if (!parent) continue;
    if (!directChildrenOf.has(parent)) directChildrenOf.set(parent, []);
    directChildrenOf.get(parent).push(row);
  }

  const originalIndex = new Map(list.map((row, i) => [row, i]));
  const isTopLevel = (row) => !parentOf.has(row);

  // BFS over the parent's whole subtree, flattened into one array (a
  // grandchild — a group nested in a group — lands in the same list as its
  // parent group's direct children), then re-sorted to original row order.
  const flattenDescendants = (root) => {
    const out = [];
    let frontier = directChildrenOf.get(root) || [];
    while (frontier.length) {
      out.push(...frontier);
      const next = [];
      for (const row of frontier) {
        const grand = directChildrenOf.get(row);
        if (grand && grand.length) next.push(...grand);
      }
      frontier = next;
    }
    return out.sort((a, b) => originalIndex.get(a) - originalIndex.get(b));
  };

  return list.filter(isTopLevel).map((row) => {
    const children = flattenDescendants(row);
    // A childless entry rolls up to its own values (mirrors kcal()'s
    // numeric tolerance in LogTable.jsx); an entry WITH children rolls up
    // over those children only — never the (zero, by design) group row.
    const source = children.length ? children : [row];
    const rollup = {
      calories: source.reduce((s, r) => s + num(r.calories), 0),
      protein: source.reduce((s, r) => s + num(r.protein), 0),
      carbs: source.reduce((s, r) => s + num(r.carbs), 0),
      fat: source.reduce((s, r) => s + num(r.fat), 0),
    };
    return { row, children, rollup };
  });
}

export default groupRows;
