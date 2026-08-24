export function buildScrollFilterSearch(searchParams, filter) {
  const next = new URLSearchParams(searchParams);
  if (filter) next.set('filter', filter); else next.delete('filter');
  return next.toString();
}

export function getScrollSourceOptions(items, limit = 10) {
  const sources = new Map();
  for (const item of items) {
    if (!item.source || sources.has(item.source)) continue;
    sources.set(item.source, item.sourceInfo?.label || item.meta?.sourceName || item.source);
    if (sources.size >= limit) break;
  }
  return [...sources];
}

export function applySessionBudget(items, budget) {
  if (!budget || items.length < budget) return { items, reached: false };
  return { items: items.slice(0, budget), reached: true };
}
