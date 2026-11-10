const idOf = row => row?.uuid ?? row?.id;
/** Normalize HTTP acknowledgments, not model proposals, into explicit result relationships. */
export function normalizeFoodOperationResult(operation, response = {}) {
  const result = response.result || response;
  const outcome = response.proposal && response.committed !== true ? 'proposal' : response.clarification || result.clarification ? 'clarification'
    : response.quarantined ? 'needs-review'
    : response.outcome || (response.committed === false || response.noFood ? 'no-food' : 'committed');
  const committed = outcome === 'committed';
  const candidates = response.items || result.items || (response.item ? [response.item] : response.data ? [response.data] : []);
  const rows = committed ? candidates.filter(row => idOf(row) != null) : [];
  const resultIds = [...new Set([...(response.entryIds || result.entryIds || []), ...rows.map(idOf)].map(String))];
  const versions = response.versions || result.versions || Object.fromEntries(rows.filter(row => row.version != null).map(row => [String(idOf(row)), row.version]));
  const removedIds = (response.removedIds || result.removedIds || []).map(String);
  const requiredIds = new Set([...(operation.targetIds || []), ...(response.affectedIds || result.affectedIds || []), ...Object.keys(versions), ...resultIds].map(String));
  removedIds.forEach(id => requiredIds.delete(id));
  const complete = [...requiredIds].every(id => rows.some(row => String(idOf(row)) === id && row.version != null && row.date));
  return { operationId: operation.id, outcome, rows, resultIds, versions, removedIds,
    affectedDates: [...new Set([operation.date, response.date, result.date, ...(response.affectedDates || result.affectedDates || []), ...rows.map(row => row.date)].filter(Boolean))],
    destination: { date: response.date || rows[0]?.date || operation.date, bucket: response.mealTime || response.bucket || operation.bucket },
    readRequired: committed && (!complete || (!rows.length && !removedIds.length)),
  };
}
