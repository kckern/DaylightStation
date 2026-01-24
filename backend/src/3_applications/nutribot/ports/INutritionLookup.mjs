// backend/src/3_applications/nutribot/ports/INutritionLookup.mjs

/**
 * Port interface for nutrition database lookups
 * @interface INutritionLookup
 */
export const INutritionLookup = {
  async lookupByName(foodName) {},
  async lookupByUPC(barcode) {}
};

export function isNutritionLookup(obj) {
  return (
    obj &&
    typeof obj.lookupByName === 'function' &&
    typeof obj.lookupByUPC === 'function'
  );
}
