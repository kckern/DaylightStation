/**
 * Shared constants for the admin interface.
 */

export const DEVICE_TYPES = [
  { value: 'shield-tv', label: 'Shield TV' },
  { value: 'linux-pc', label: 'Linux PC' },
  { value: 'midi-keyboard', label: 'MIDI Keyboard' },
];

export const MEMBER_TYPES = [
  { value: 'owner', label: 'Owner' },
  { value: 'family_member', label: 'Family Member' },
];

export const MEMBER_GROUPS = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
];

export const INTEGRATION_CATEGORIES = {
  media: 'Media',
  gallery: 'Gallery',
  audiobooks: 'Audiobooks',
  ebooks: 'Ebooks',
  home_automation: 'Home Automation',
  ai: 'AI',
  finance: 'Finance',
  messaging: 'Messaging',
};

export const INTEGRATION_CATEGORY_ORDER = [
  'media', 'gallery', 'audiobooks', 'ebooks',
  'home_automation', 'ai', 'finance', 'messaging',
];

/** Badge color by member type */
export function typeBadgeColor(type) {
  switch (type) {
    case 'owner': return 'blue';
    case 'family_member': return 'teal';
    default: return 'gray';
  }
}

/** Badge color by member group */
export function groupBadgeColor(group) {
  switch (group) {
    case 'primary': return 'violet';
    case 'secondary': return 'orange';
    default: return 'gray';
  }
}

/** Badge color by job status */
export function statusBadgeColor(status) {
  switch (status) {
    case 'success': return 'green';
    case 'running': return 'blue';
    case 'failed': case 'error': return 'red';
    case 'disabled': return 'gray';
    default: return 'gray';
  }
}

/** Classify cron expression into frequency band */
export function getFrequencyBand(schedule) {
  if (!schedule) return 'Other';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return 'Other';
  const [min, hour] = parts;
  if (min.startsWith('*/')) {
    const interval = parseInt(min.slice(2), 10);
    if (interval <= 15) return 'Frequent';
    return 'Hourly';
  }
  if (min === '0' && hour === '*') return 'Hourly';
  if (hour !== '*') return 'Daily';
  return 'Other';
}
