/**
 * Constants for ContentLists module
 */

// Action options for items
export const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Shuffle', label: 'Shuffle' }
];

// Sorting options for lists
export const SORTING_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'random', label: 'Random' },
  { value: 'recent', label: 'Recently Added' }
];

// Days presets for scheduling
export const DAYS_PRESETS = [
  { value: null, label: 'Any Day' },
  { value: 'Daily', label: 'Daily' },
  { value: 'Weekdays', label: 'Weekdays (M-F)' },
  { value: 'Weekend', label: 'Weekend (Sat-Sun)' },
  { value: 'MWF', label: 'Mon • Wed • Fri' },
  { value: 'TTh', label: 'Tue • Thu' }
];

// Known item fields that the editor manages
export const KNOWN_ITEM_FIELDS = [
  // Identity
  'label', 'input', 'action', 'active', 'group', 'image', 'uid',
  // Playback
  'shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate',
  // Scheduling
  'days', 'snooze', 'waitUntil',
  // Display
  'shader', 'composite', 'playable',
  // Progress (usually read-only)
  'progress', 'watched'
];

// Default values for item fields
export const ITEM_DEFAULTS = {
  action: 'Play',
  active: true,
  shuffle: false,
  continuous: false,
  loop: false,
  fixedOrder: false,
  volume: 100,
  playbackRate: 1.0,
  days: null,
  snooze: null,
  waitUntil: null,
  shader: null,
  composite: false,
  playable: true,
  progress: null,
  watched: false
};

// Config indicators for table display - ordered by priority
// Shows icon when value differs from default
export const CONFIG_INDICATORS = [
  { field: 'shuffle', icon: 'IconArrowsShuffle', label: 'Shuffle' },
  { field: 'continuous', icon: 'IconRepeat', label: 'Continuous' },
  { field: 'loop', icon: 'IconRepeatOnce', label: 'Loop' },
  { field: 'fixedOrder', icon: 'IconSortAscending', label: 'Fixed Order' },
  { field: 'volume', icon: 'IconVolume', label: 'Custom Volume', condition: (v) => v !== 100 && v != null },
  { field: 'playbackRate', icon: 'IconPlayerPlay', label: 'Custom Speed', condition: (v) => v !== 1.0 && v != null },
  { field: 'days', icon: 'IconCalendar', label: 'Scheduled', condition: (v) => v != null },
  { field: 'snooze', icon: 'IconClockPause', label: 'Snoozed', condition: (v) => v != null },
  { field: 'waitUntil', icon: 'IconClockPlay', label: 'Delayed', condition: (v) => v != null },
  { field: 'shader', icon: 'IconBrush', label: 'Custom Shader', condition: (v) => v != null },
  { field: 'composite', icon: 'IconStack2', label: 'Composite' }
];

// Maximum number of config icons to show in table (rest shown as "+N")
export const MAX_CONFIG_ICONS = 2;

// List-level field defaults
export const LIST_DEFAULTS = {
  title: null,
  description: null,
  group: null,
  icon: null,
  sorting: 'manual',
  days: null,
  active: true,
  defaultAction: 'Play',
  defaultVolume: null,
  defaultPlaybackRate: null
};
