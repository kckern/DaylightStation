import { MEAL_BUCKETS, bucketForHour, PRIMARY_BUCKETS, EARLY_COLUMN, LATE_COLUMN } from '@shared-contracts/health/mealBuckets.mjs';
import { localDateISO } from '@shared-contracts/health/isoDate.mjs';

export const BUCKETS = MEAL_BUCKETS;
export const UNGROUPED = { id: null, label: 'Ungrouped' };
export const localTodayISO = (date = new Date()) => localDateISO(date);
export const currentMealBucketId = (date = new Date()) => bucketForHour(date.getHours());
export { bucketForHour, PRIMARY_BUCKETS, EARLY_COLUMN, LATE_COLUMN };
export const bucketLabel = id => BUCKETS.find(bucket => bucket.id === id)?.label || id;
