export const MEAL_BUCKETS = Object.freeze([
  { id: 'morning', label: 'Breakfast' }, { id: 'afternoon', label: 'Lunch' },
  { id: 'evening', label: 'Dinner' }, { id: 'night', label: 'Snacks' },
]);
// Lunch and Dinner, the day's main meals. Today no longer uses this to hide
// meals — every meal renders, empty or not, Breakfast→Lunch in the early
// column and Dinner→Snacks in the late one.
export const PRIMARY_BUCKETS = Object.freeze(['afternoon', 'evening']);
export const EARLY_COLUMN = Object.freeze(['morning', 'afternoon']);
export const LATE_COLUMN = Object.freeze(['evening', 'night']);
export const bucketForHour = hour => hour >= 5 && hour < 12 ? 'morning'
  : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
