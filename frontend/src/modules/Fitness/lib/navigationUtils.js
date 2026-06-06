/**
 * Sort navigation items by order field, falling back to array position
 */
export function sortNavItems(navItems) {
  if (!Array.isArray(navItems)) return [];
  return [...navItems].sort((a, b) => {
    const orderA = a.order ?? navItems.indexOf(a);
    const orderB = b.order ?? navItems.indexOf(b);
    return orderA - orderB;
  });
}

/**
 * Filter nav items by day-of-week visibility.
 *
 * An item may carry an optional `days` array listing the days of the week it
 * should appear on, using the JS `Date.getDay()` convention
 * (0 = Sunday … 6 = Saturday). Example: `days: [6]` shows the item only on
 * Saturdays.
 *
 * Items without a `days` field — or with a non-array / empty `days` value —
 * are always shown (forgiving default, so a malformed config never silently
 * hides a tab).
 *
 * @param {Array} navItems
 * @param {number} [today] - Day-of-week override (mainly for tests); defaults
 *   to the current local day via `new Date().getDay()`.
 * @returns {Array} Items visible on the given day, in original order.
 */
export function filterNavItemsByDay(navItems, today = new Date().getDay()) {
  if (!Array.isArray(navItems)) return [];
  return navItems.filter((item) => {
    if (!item || !Array.isArray(item.days) || item.days.length === 0) return true;
    return item.days.includes(today);
  });
}

/**
 * Generate CSS class names for a nav item
 */
export function getNavItemClasses(item, isActive = false) {
  return [
    'nav-item',
    `nav-item--${item.type}`,
    item.className,
    isActive && 'active'
  ].filter(Boolean).join(' ');
}

/**
 * Determine if a nav item is currently active
 */
export function isNavItemActive(item, currentState) {
  const { currentView, activeCollection, activeModule, activeScreen } = currentState;

  if (!item || !item.target) return false;

  switch (item.type) {
    case 'collection':
    case 'plex_collection':
      return String(activeCollection) === String(item.target.collection_id);

    case 'collection_group':
    case 'plex_collection_group':
      if (Array.isArray(activeCollection)) {
        // Exact match: same IDs in same order (not partial overlap)
        const ids = item.target.collection_ids;
        return ids.length === activeCollection.length &&
          ids.every((id, i) => String(id) === String(activeCollection[i]));
      }
      return item.target.collection_ids.length === 1 &&
        String(item.target.collection_ids[0]) === String(activeCollection);

    case 'module_menu':
      return String(activeCollection) === String(item.target.menu_id);

    case 'module_direct':
      return currentView === 'module' &&
             activeModule?.id === item.target.module_id;

    case 'screen':
      return currentView === 'screen' && activeScreen === item.target.screen_id;

    case 'view_direct':
      return currentView === item.target.view;

    default:
      return false;
  }
}

/**
 * Generate deep link URL for a nav item
 */
export function getNavItemDeepLink(item) {
  if (!item || !item.target) return '#/fitness';

  switch (item.type) {
    case 'collection':
    case 'plex_collection':
      return `#/fitness/collection/${item.target.collection_id}`;

    case 'collection_group':
    case 'plex_collection_group':
      return `#/fitness/collections/${item.target.collection_ids.join(',')}`;

    case 'module_menu':
      return `#/fitness/menu/${item.target.menu_id}`;

    case 'module_direct':
      return `#/fitness/module/${item.target.module_id}`;

    case 'screen':
      return `#/fitness/${item.target.screen_id}`;

    case 'view_direct':
      return `#/fitness/view/${item.target.view}`;

    default:
      return '#/fitness';
  }
}
