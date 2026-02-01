import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useImagePreloader - Preloads upcoming images in a carousel
 *
 * Prefetches the next N images to ensure smooth transitions.
 * Tracks load status per image and reports failed indexes.
 *
 * @param {Array<{id: string, url: string}>} items - Array of image items
 * @param {number} currentIndex - Currently displayed image index
 * @param {number} preloadCount - Number of images to preload ahead (default: 3)
 *
 * @returns {Object} Preloader state
 * @returns {boolean} returns.isPreloaded - True if current + next image are loaded
 * @returns {Set<number>} returns.failedIndexes - Set of indexes that failed to load
 * @returns {Map<number, 'loading'|'loaded'|'error'>} returns.loadStatus - Status per index
 */
export function useImagePreloader(items, currentIndex, preloadCount = 3) {
  const [loadStatus, setLoadStatus] = useState(new Map());
  const [failedIndexes, setFailedIndexes] = useState(new Set());
  const preloadersRef = useRef(new Map()); // Track active Image objects
  const prevItemsRef = useRef(null); // Track previous items to detect changes

  /**
   * Single combined effect: Reset on item change, then preload
   * This ensures reset happens atomically before preloading starts
   */
  useEffect(() => {
    if (!items || items.length === 0) return;

    // Check if items array actually changed (by identity or first item id)
    const itemsChanged = prevItemsRef.current !== items;
    const firstItemChanged = prevItemsRef.current?.[0]?.id !== items[0]?.id;

    if (itemsChanged && firstItemChanged) {
      // Reset state when items actually change (new carousel)

      // Clear all existing preloaders
      preloadersRef.current.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
      preloadersRef.current.clear();

      // Reset state
      setLoadStatus(new Map());
      setFailedIndexes(new Set());
    }

    prevItemsRef.current = items;

    // Helper to preload a single image
    const preloadImage = (index) => {
      if (index < 0 || index >= items.length) return;

      const item = items[index];
      if (!item?.url) return;

      // Skip if already loading or loaded
      if (preloadersRef.current.has(index)) return;

      // Create Image object for preloading
      const img = new Image();
      preloadersRef.current.set(index, img);

      // Mark as loading
      setLoadStatus((prev) => {
        const next = new Map(prev);
        next.set(index, 'loading');
        return next;
      });

      img.onload = () => {
        setLoadStatus((prev) => {
          const next = new Map(prev);
          next.set(index, 'loaded');
          return next;
        });
      };

      img.onerror = () => {
        setLoadStatus((prev) => {
          const next = new Map(prev);
          next.set(index, 'error');
          return next;
        });
        setFailedIndexes((prev) => {
          const next = new Set(prev);
          next.add(index);
          return next;
        });
      };

      // Start loading
      img.src = item.url;
    };

    // Preload current image first
    preloadImage(currentIndex);

    // Preload next N images (with wrap-around support)
    for (let i = 1; i <= preloadCount; i++) {
      const nextIndex = (currentIndex + i) % items.length;
      // Don't wrap around if we're not at the end yet
      if (currentIndex + i < items.length || items.length > preloadCount) {
        preloadImage(nextIndex);
      }
    }

    // Optionally preload one previous image for reverse navigation
    const prevIndex = (currentIndex - 1 + items.length) % items.length;
    if (currentIndex > 0) {
      preloadImage(prevIndex);
    }

    // Cleanup on unmount
    return () => {
      preloadersRef.current.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [items, currentIndex, preloadCount]);

  /**
   * Calculate if current and next images are preloaded
   */
  const currentStatus = loadStatus.get(currentIndex);
  const nextIndex = (currentIndex + 1) % items.length;
  const nextStatus = loadStatus.get(nextIndex);

  const isPreloaded =
    (currentStatus === 'loaded' || currentStatus === 'error') &&
    (items.length <= 1 || nextStatus === 'loaded' || nextStatus === 'error');

  return {
    isPreloaded,
    failedIndexes,
    loadStatus,
    isCurrentLoaded: currentStatus === 'loaded',
    isCurrentFailed: currentStatus === 'error'
  };
}

export default useImagePreloader;
