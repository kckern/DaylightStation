/** Legacy barcode captures have no recorded serving-basis audit. Do not silently
 * grandfather their estimates into the new confirmation flow. */
export function nutritionLookupFor(log) {
  return log.metadata?.nutritionLookup ?? (log.metadata?.source === 'upc' ? {
    source: 'legacy-barcode', basis: 'unknown', missing: [],
    warnings: ['This barcode was imported before serving-basis checks. Verify its serving and nutrition against the product label.'],
  } : null);
}
