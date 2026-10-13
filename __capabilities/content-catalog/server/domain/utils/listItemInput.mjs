// Semantic mapping between supported list-item command shapes.
const AUTHORED_TITLE = Symbol.for('daylight.list-item-authored-title');

function preserveAuthoredTitle(result, source) {
  if (source?.title != null) Object.defineProperty(result, AUTHORED_TITLE, { value: true, enumerable: true });
  return result;
}

function normalizeInput(input) {
  if (!input) return '';
  return input.split(';').map(seg => seg.trim().replace(/^(\w+):\s+/, '$1:')).join(';');
}

export function normalizeListItem(item) {
  if (!item) return item;
  if (!item.input && !item.label && (item.play || item.open || item.display || item.list || item.queue || item.launch)) {
    return preserveAuthoredTitle({ ...item }, item);
  }
  const result = {};
  result.title = item.title || item.label;
  if (item.label != null) result.label = item.label;
  if (item.src && item.media_key != null) {
    result.play = { contentId: `${item.src}:${String(item.media_key)}` };
    for (const field of ['program', 'priority', 'wait_until', 'skip_after', 'watched', 'progress', 'summary', 'hold', 'assetId', 'playable']) {
      if (item[field] != null) result[field] = item[field];
    }
  } else if (item.input) {
    const normalized = normalizeInput(item.input);
    if (normalized.startsWith('android:')) {
      const rest = normalized.slice('android:'.length);
      const slashIdx = rest.indexOf('/');
      result.android = { package: slashIdx >= 0 ? rest.slice(0, slashIdx) : rest, activity: slashIdx >= 0 ? rest.slice(slashIdx + 1) : '' };
    } else {
      const action = (item.action || 'Play').toLowerCase();
      if (action === 'open') {
        const colonIdx = normalized.indexOf(':');
        result.open = colonIdx >= 0 ? normalized.slice(colonIdx + 1) : normalized;
      } else if (['display', 'list', 'queue', 'launch'].includes(action)) {
        result[action] = { contentId: normalized };
      } else {
        result.play = { contentId: normalized };
      }
    }
  }
  for (const field of ['uid', 'image', 'fixed_order', 'active', 'continuous', 'shuffle', 'menuStyle', 'playbackrate', 'shader', 'days', 'applySchedule', 'strategy']) {
    if (item[field] != null) result[field] = item[field];
  }
  return preserveAuthoredTitle(result, item);
}

export function extractContentId(item) {
  if (!item) return '';
  return item.input || item.play?.contentId || item.list?.contentId || item.queue?.contentId
    || item.display?.contentId || item.launch?.contentId || (item.open ? `app:${item.open}` : '')
    || (item.android ? `android:${item.android.package}/${item.android.activity}` : '') || '';
}

export function extractActionName(item) {
  if (!item) return 'Play';
  if (item.action) return item.action;
  for (const [field, label] of [['android', 'Android'], ['play', 'Play'], ['queue', 'Queue'], ['list', 'List'], ['display', 'Display'], ['launch', 'Launch'], ['open', 'Open']]) {
    if (item[field]) return label;
  }
  return 'Play';
}
