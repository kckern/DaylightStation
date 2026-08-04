/**
 * Pure projection over `/api/v1/school/certification` rows for ONE surface
 * (already filtered by `?surface=`), plus the fail-closed launch gate the
 * screen app consults before opening a catalog module. Module-level verdicts
 * are `'render'` | `'incompatible'` (spec §4 verdicts) — only `'render'`
 * clears a launch; an unknown moduleId or a missing/null verdict map both
 * refuse, same as a certification the caller never fetched.
 */

/** rows (one surface) -> Map(moduleId -> {verdict, reasons}). */
export function buildVerdictMap(rows) {
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const moduleVerdicts = Array.isArray(row?.moduleVerdicts) ? row.moduleVerdicts : [];
    for (const mv of moduleVerdicts) {
      if (!mv?.moduleId) continue;
      map.set(mv.moduleId, { verdict: mv.verdict, reasons: Array.isArray(mv.reasons) ? mv.reasons : [] });
    }
  }
  return map;
}

/** Fail closed: no map, or an unknown/non-'render' moduleId -> false. */
export function moduleLaunchAllowed(verdictMap, moduleId) {
  if (!verdictMap || typeof verdictMap.get !== 'function') return false;
  return verdictMap.get(moduleId)?.verdict === 'render';
}
