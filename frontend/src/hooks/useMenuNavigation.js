import { useCallback, useEffect, useState } from 'react';
import { useMenuNavigationContext, useHasMenuNavigationContext } from '../context/MenuNavigationContext';

/**
 * Hook for menu keyboard navigation.
 * Handles arrow keys, Enter, Escape with proper depth awareness.
 * 
 * @param {Object} options
 * @param {Array} options.items - Menu items array
 * @param {number} [options.columns=5] - Number of columns for grid navigation
 * @param {number} options.depth - Current menu depth
 * @param {Function} options.onSelect - Callback when item is selected (Enter)
 * @param {boolean} [options.enabled=true] - Whether navigation is enabled
 * @returns {Object} Navigation state and helpers
 */
export function useMenuNavigation({
  items = [],
  columns = 5,
  depth,
  onSelect,
  enabled = true,
}) {
  const hasContext = useHasMenuNavigationContext();
  
  if (!hasContext) {
    throw new Error('useMenuNavigation must be used within MenuNavigationProvider');
  }
  
  const { getSelection, setSelectionAtDepth, pop } = useMenuNavigationContext();
  
  const { index: selectedIndex, key: selectedKey } = getSelection(depth);
  
  /**
   * Update selected index (and optionally key)
   */
  const setSelectedIndex = useCallback((newIndex, key = null) => {
    setSelectionAtDepth(depth, newIndex, key);
  }, [depth, setSelectionAtDepth]);

  /**
   * Get a unique key for an item (for selection persistence across refreshes)
   * @param {Object} item - Menu item
   * @returns {string|null} Unique key or null
   */
  const getItemKey = useCallback((item) => {
    if (!item) return null;
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    return item?.id ?? item?.key ?? actionVal ?? item?.label ?? null;
  }, []);

  /**
   * Navigate to a specific index
   */
  const navigateToIndex = useCallback((newIndex) => {
    const clampedIndex = Math.max(0, Math.min(newIndex, items.length - 1));
    const key = getItemKey(items[clampedIndex]);
    setSelectedIndex(clampedIndex, key);
  }, [items, getItemKey, setSelectedIndex]);

  /**
   * Keyboard handler
   */
  const handleKeyDown = useCallback((e) => {
    if (!enabled || !items.length) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (items[selectedIndex]) {
          onSelect?.(items[selectedIndex]);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        {
          const next = (selectedIndex - columns + items.length) % items.length;
          const key = getItemKey(items[next]);
          setSelectedIndex(next, key);
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        {
          const next = (selectedIndex + columns) % items.length;
          const key = getItemKey(items[next]);
          setSelectedIndex(next, key);
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        {
          const next = (selectedIndex - 1 + items.length) % items.length;
          const key = getItemKey(items[next]);
          setSelectedIndex(next, key);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        {
          const next = (selectedIndex + 1) % items.length;
          const key = getItemKey(items[next]);
          setSelectedIndex(next, key);
        }
        break;

      case 'Escape':
        e.preventDefault();
        pop();
        break;

      default:
        // Alphanumeric: move to next item (quick skip behavior)
        if (!e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
          const key = e.key.toLowerCase();
          if (/^[a-z0-9]$/.test(key)) {
            e.preventDefault();
            const next = (selectedIndex + 1) % items.length;
            const itemKey = getItemKey(items[next]);
            setSelectedIndex(next, itemKey);
          }
        }
        break;
    }
  }, [enabled, items, selectedIndex, columns, onSelect, setSelectedIndex, getItemKey, pop]);

  // Attach keyboard listener
  useEffect(() => {
    if (!enabled) return;
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);

  // Restore selection by key when items change, or clamp index
  useEffect(() => {
    if (!items.length) return;

    // Try to restore by key first
    const matchIndex = selectedKey
      ? items.findIndex((item) => getItemKey(item) === selectedKey)
      : -1;

    if (matchIndex >= 0) {
      if (matchIndex !== selectedIndex) {
        setSelectedIndex(matchIndex, selectedKey);
      }
      return;
    }

    // Fallback: clamp index if out of bounds
    if (selectedIndex >= items.length) {
      const clamped = Math.max(0, items.length - 1);
      const key = getItemKey(items[clamped]);
      setSelectedIndex(clamped, key);
    }
  }, [items, selectedIndex, selectedKey, setSelectedIndex, getItemKey]);

  return {
    selectedIndex,
    selectedKey,
    setSelectedIndex,
    navigateToIndex,
    getItemKey,
  };
}

/**
 * Hook for standalone menu navigation (without context).
 * Useful for components that don't need the full navigation stack.
 * 
 * @param {Object} options
 * @param {Array} options.items - Menu items array
 * @param {number} [options.columns=5] - Number of columns for grid navigation
 * @param {number} [options.initialIndex=0] - Initial selected index
 * @param {Function} options.onSelect - Callback when item is selected
 * @param {Function} [options.onEscape] - Callback when Escape is pressed
 * @param {boolean} [options.enabled=true] - Whether navigation is enabled
 */
export function useStandaloneMenuNavigation({
  items = [],
  columns = 5,
  initialIndex = 0,
  onSelect,
  onEscape,
  enabled = true,
}) {
  const [selectedIndex, setSelectedIndexState] = useState(initialIndex);

  const getItemKey = useCallback((item) => {
    if (!item) return null;
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    return item?.id ?? item?.key ?? actionVal ?? item?.label ?? null;
  }, []);

  const setSelectedIndex = useCallback((newIndex) => {
    setSelectedIndexState(Math.max(0, Math.min(newIndex, items.length - 1)));
  }, [items.length]);

  const handleKeyDown = useCallback((e) => {
    if (!enabled || !items.length) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (items[selectedIndex]) {
          onSelect?.(items[selectedIndex]);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((selectedIndex - columns + items.length) % items.length);
        break;

      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((selectedIndex + columns) % items.length);
        break;

      case 'ArrowLeft':
        e.preventDefault();
        setSelectedIndex((selectedIndex - 1 + items.length) % items.length);
        break;

      case 'ArrowRight':
        e.preventDefault();
        setSelectedIndex((selectedIndex + 1) % items.length);
        break;

      case 'Escape':
        e.preventDefault();
        onEscape?.();
        break;

      default:
        break;
    }
  }, [enabled, items, selectedIndex, columns, onSelect, onEscape, setSelectedIndex]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);

  // Clamp when items change
  useEffect(() => {
    if (selectedIndex >= items.length && items.length > 0) {
      setSelectedIndexState(items.length - 1);
    }
  }, [items.length, selectedIndex]);

  return {
    selectedIndex,
    setSelectedIndex,
    getItemKey,
  };
}

export default useMenuNavigation;
