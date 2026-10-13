export const MEAL_BUCKETS = Object.freeze([
  { id: 'morning', label: 'Breakfast' }, { id: 'afternoon', label: 'Lunch' },
  { id: 'evening', label: 'Dinner' }, { id: 'night', label: 'Snacks' },
]);
// Every meal renders on Today, empty or not: Breakfast→Lunch in the early
// column, Dinner→Snacks in the late one.
export const EARLY_COLUMN = Object.freeze(['morning', 'afternoon']);
export const LATE_COLUMN = Object.freeze(['evening', 'night']);
export const bucketForHour = hour => hour >= 5 && hour < 12 ? 'morning'
  : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
