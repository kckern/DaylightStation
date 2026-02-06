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
  const { currentView, activeCollection, activePlugin } = currentState;
  
  if (!item || !item.target) return false;

  switch (item.type) {
    case 'collection':
    case 'plex_collection':
      return String(activeCollection) === String(item.target.collection_id);

    case 'collection_group':
    case 'plex_collection_group':
      if (Array.isArray(activeCollection)) {
        return item.target.collection_ids.some(id => 
          activeCollection.includes(id)
        );
      }
      return item.target.collection_ids.includes(activeCollection);
      
    case 'plugin_menu':
      return String(activeCollection) === String(item.target.menu_id);
      
    case 'plugin_direct':
      return currentView === 'plugin' && 
             activePlugin?.id === item.target.plugin_id;
      
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
      
    case 'plugin_menu':
      return `#/fitness/menu/${item.target.menu_id}`;
      
    case 'plugin_direct':
      return `#/fitness/plugin/${item.target.plugin_id}`;
      
    case 'view_direct':
      return `#/fitness/view/${item.target.view}`;
      
    default:
      return '#/fitness';
  }
}
