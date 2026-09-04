/** Established HTTP projection for a food catalog entry. */
export function presentFoodCatalogEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    normalizedName: entry.normalizedName,
    nutrients: entry.nutrients,
    source: entry.source,
    barcodeUpc: entry.barcodeUpc,
    useCount: entry.useCount,
    icon: entry.icon ?? null,
    lastUsed: entry.lastUsed,
    createdAt: entry.createdAt,
  };
}
