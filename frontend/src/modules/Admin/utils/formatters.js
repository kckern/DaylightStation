/**
 * Shared formatting utilities for the admin interface.
 */

/** Format bytes into human-readable size */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Format ISO date string to relative time (e.g., "3m ago", "2h ago") */
export function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}m ${remainingSec}s`;
}

/** Capitalize first letter of a string */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Convert kebab-case to Title Case */
export function kebabToTitle(str) {
  if (!str) return '';
  return str.split('-').map(capitalize).join(' ');
}

/** Truncate a URL for display */
export function truncateUrl(url, maxLength = 40) {
  if (!url) return '';
  if (url.length <= maxLength) return url;
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  if (withoutProtocol.length <= maxLength) return withoutProtocol;
  return withoutProtocol.substring(0, maxLength - 3) + '...';
}

/** Convert cron expression to human-readable string */
export function cronToHuman(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (min === '0' && hour === '*') return 'Hourly';
  if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:00 ${ampm}`;
  }
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  return expr;
}
