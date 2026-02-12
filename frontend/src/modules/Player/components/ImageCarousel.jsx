import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useImagePreloader } from '../hooks/useImagePreloader.js';
import '../styles/ImageCarousel.scss';

/**
 * ImageCarousel - Fullscreen image carousel with fade transitions
 *
 * Displays images from an array of items with smooth fade transitions
 * between slides. Supports captions, preloading, and error handling.
 *
 * @param {Object} props - Component props
 * @param {Array<{id: string, url: string, duration?: number, caption?: string}>} props.items - Image items to display
 * @param {boolean} props.loop - Whether to loop back to start after last item
 * @param {number} props.currentIndex - Current image index (controlled by useAdvanceController)
 * @param {Function} props.onAdvance - Callback when carousel should auto-advance
 * @param {Function} props.onItemError - Callback when an image fails to load
 * @param {boolean} props.showCounter - Whether to show image counter (e.g., "3 / 10")
 */
export function ImageCarousel({
  items = [],
  loop = false,
  currentIndex = 0,
  onAdvance,
  onItemError,
  showCounter = false
}) {
  const [previousIndex, setPreviousIndex] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const transitionTimeoutRef = useRef(null);
  const currentIndexRef = useRef(currentIndex);

  // Preload upcoming images
  const { isCurrentLoaded, isCurrentFailed, failedIndexes } = useImagePreloader(
    items,
    currentIndex,
    3 // Preload 3 images ahead
  );

  // Get current and previous items
  const currentItem = items[currentIndex] || null;
  const previousItem = previousIndex !== null ? items[previousIndex] : null;

  /**
   * Handle image load errors
   */
  const handleImageError = useCallback(
    (index, url) => {
      if (onItemError) {
        onItemError(index, url);
      }
    },
    [onItemError]
  );

  /**
   * Effect: Handle index changes with transition
   */
  useEffect(() => {
    // Skip if this is the initial render or same index
    if (currentIndexRef.current === currentIndex && previousIndex === null) {
      currentIndexRef.current = currentIndex;
      return;
    }

    // Start transition: remember the previous index
    if (currentIndexRef.current !== currentIndex) {
      setPreviousIndex(currentIndexRef.current);
      setIsTransitioning(true);

      // Clear any existing timeout
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }

      // End transition after fade duration (500ms matches CSS)
      transitionTimeoutRef.current = setTimeout(() => {
        setPreviousIndex(null);
        setIsTransitioning(false);
      }, 500);

      currentIndexRef.current = currentIndex;
    }

    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [currentIndex, previousIndex]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Empty state
  if (!items || items.length === 0) {
    return (
      <div
        className="image-carousel"
        data-track="visual"
        data-visual-type="image"
      >
        <div className="image-carousel__empty">No images available</div>
      </div>
    );
  }

  // Error state for current image
  if (isCurrentFailed && !currentItem?.url) {
    return (
      <div
        className="image-carousel"
        data-track="visual"
        data-visual-type="image"
        data-image-index={currentIndex}
        data-image-id={currentItem?.id}
      >
        <div className="image-carousel__error">
          <div className="image-carousel__error-icon">!</div>
          <p className="image-carousel__error-message">
            Failed to load image
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="image-carousel"
      data-track="visual"
      data-visual-type="image"
      data-image-index={currentIndex}
      data-image-id={currentItem?.id}
    >
      <div className="image-carousel__slide-container">
        {/* Previous slide (exiting) */}
        {isTransitioning && previousItem && (
          <div
            className="image-carousel__slide image-carousel__slide--exiting"
            key={`prev-${previousIndex}`}
          >
            <img
              className="image-carousel__image"
              src={previousItem.url}
              alt={previousItem.caption || `Image ${previousIndex + 1}`}
              draggable={false}
            />
          </div>
        )}

        {/* Current slide (active) */}
        {currentItem && (
          <div
            className="image-carousel__slide image-carousel__slide--active"
            key={`current-${currentIndex}`}
          >
            {!isCurrentLoaded && !failedIndexes.has(currentIndex) ? (
              <div className="image-carousel__loading">
                <div className="image-carousel__loading-spinner" />
              </div>
            ) : failedIndexes.has(currentIndex) ? (
              <div className="image-carousel__error">
                <div className="image-carousel__error-icon">!</div>
                <p className="image-carousel__error-message">
                  Failed to load image
                </p>
              </div>
            ) : (
              <img
                className="image-carousel__image"
                src={currentItem.url}
                alt={currentItem.caption || `Image ${currentIndex + 1}`}
                draggable={false}
                onError={() => handleImageError(currentIndex, currentItem.url)}
              />
            )}
          </div>
        )}
      </div>

      {/* Caption overlay */}
      {currentItem?.caption && (
        <div className="image-carousel__caption">
          <p className="image-carousel__caption-text">{currentItem.caption}</p>
        </div>
      )}

      {/* Image counter */}
      {showCounter && items.length > 1 && (
        <div className="image-carousel__counter">
          {currentIndex + 1} / {items.length}
        </div>
      )}
    </div>
  );
}

ImageCarousel.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      url: PropTypes.string.isRequired,
      duration: PropTypes.number,
      caption: PropTypes.string
    })
  ),
  loop: PropTypes.bool,
  currentIndex: PropTypes.number,
  onAdvance: PropTypes.func,
  onItemError: PropTypes.func,
  showCounter: PropTypes.bool
};

export default ImageCarousel;
