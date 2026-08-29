// backend/src/3_applications/nutribot/ports/INutritionLookup.mjs

/**
 * Port interface for nutrition database lookups
 * @interface INutritionLookup
 */
export class INutritionLookup {
  async lookupByName(_foodName) { throw new Error('INutritionLookup.lookupByName not implemented'); }
  async lookupByUPC(_barcode) { throw new Error('INutritionLookup.lookupByUPC not implemented'); }
}

export function isNutritionLookup(obj) {
  return (
    obj &&
    typeof obj.lookupByName === 'function' &&
    typeof obj.lookupByUPC === 'function'
  );
}
