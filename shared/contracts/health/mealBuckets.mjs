export const MEAL_BUCKETS = Object.freeze([
  { id: 'morning', label: 'Breakfast' }, { id: 'afternoon', label: 'Lunch' },
  { id: 'evening', label: 'Dinner' }, { id: 'night', label: 'Snacks' },
]);
export const bucketForHour = hour => hour >= 5 && hour < 12 ? 'morning'
  : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
