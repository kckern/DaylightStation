export const MEAL_BUCKETS = Object.freeze([
  { id: 'morning', label: 'Breakfast' }, { id: 'afternoon', label: 'Lunch' },
  { id: 'evening', label: 'Dinner' }, { id: 'night', label: 'Snacks' },
]);
// The two meals every day shows, empty or not. Lunch heads the early column
// and Dinner the late one; Breakfast and Snacks appear only when they hold
// food, above Lunch and below Dinner respectively.
export const PRIMARY_BUCKETS = Object.freeze(['afternoon', 'evening']);
export const EARLY_COLUMN = Object.freeze(['morning', 'afternoon']);
export const LATE_COLUMN = Object.freeze(['evening', 'night']);
export const bucketForHour = hour => hour >= 5 && hour < 12 ? 'morning'
  : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
