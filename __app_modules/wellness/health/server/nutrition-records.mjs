/** Health-owned nutrition record creation, serialization and capture stamp. */
export { createNutriLog } from './application/nutrition/nutriLogRecords.mjs';
export { serializeFoodItem, serializeNutriLog } from './application/nutrition/NutriLogProjection.mjs';
export { stampUnsettled, default } from './application/nutrition/stampUnsettled.mjs';
