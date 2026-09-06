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
    // The PIN, alongside the picture. `icon` alone cannot say where it came
    // from: recordUsage FILLS an absent icon from whatever capture named one
    // first, so a slug there may be an inference nobody chose. `iconOverride`
    // is only ever written by `PUT /nutrition/catalog/icon` — the edit sheet's
    // "always for this food" — so a non-null value means a person picked it.
    // Presenting it is what lets that PUT's own caller check what it just set,
    // and lets a client tell "pinned" from "guessed" without a second call.
    iconOverride: entry.iconOverride ?? null,
    favorite: entry.favorite === true,
    lastUsed: entry.lastUsed,
    createdAt: entry.createdAt,
  };
}
