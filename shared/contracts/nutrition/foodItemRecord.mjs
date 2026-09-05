/** Complete transport/persistence shape. Absence of settled means legacy. */
export function serializeFoodItem(item) {
  const fields = ['id', 'uuid', 'label', 'icon', 'grams', 'unit', 'amount', 'color',
    'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol',
    'kind', 'parentId', 'photoRef', 'settledBy', 'settledAt', 'microsSource',
    'foodId', 'nutrientProvenance', 'originalQuantity', 'manualFields', 'cleanupFields'];
  return {
    ...Object.fromEntries(fields.map(key => [key, item[key]])),
    ...(item.settled !== undefined ? { settled: item.settled } : {}),
  };
}
