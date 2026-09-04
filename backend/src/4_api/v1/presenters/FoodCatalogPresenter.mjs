/** Established HTTP projection for a food catalog entry. */
export function presentFoodCatalogEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    normalizedName: entry.normalizedName,
    // DERIVED (FoodCatalogEntry.nutrients): the observation nearest the median
    // density, scaled to the median mass. Same shape as it has always been, so
    // every existing client keeps working; the three fields below say what the
    // number is made of, for anything that wants to show its work.
    nutrients: entry.nutrients,
    canonicalGrams: entry.canonicalGrams ?? null,
    densityKcalPerGram: entry.densityKcalPerGram ?? null,
    observationCount: entry.observationSampleCount ?? 0,
    source: entry.source,
    barcodeUpc: entry.barcodeUpc,
    useCount: entry.useCount,
    icon: entry.icon ?? null,
    lastUsed: entry.lastUsed,
    createdAt: entry.createdAt,
  };
}
