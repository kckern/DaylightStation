import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * useDynamicDimensions
 * --------------------
 * Custom hook for tracking element dimensions dynamically with multiple measurement strategies:
 * - ResizeObserver for modern browsers
 * - Interval-based fallback for older browsers
 * - Window resize listener
 * - Manual trigger capability
 * 
 * @param {Array} dependencies - Array of dependencies that should trigger re-measurement
 * @returns {Object} - { 
 *   panelRef, 
 *   contentRef, 
 *   panelHeight, 
 *   contentHeight, 
 *   measureDimensions 
 * }
 */
export function useDynamicDimensions(dependencies = []) {
  // Refs for the elements to measure
  const panelRef = useRef(null);
  const contentRef = useRef(null);
  
  // Dimension state
  const [panelHeight, setPanelHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  // Measure dimensions dynamically
  const measureDimensions = useCallback(() => {
    if (panelRef.current) {
      const newPanelHeight = panelRef.current.clientHeight;
      setPanelHeight(prev => prev !== newPanelHeight ? newPanelHeight : prev);
    }
    if (contentRef.current) {
      const newContentHeight = contentRef.current.clientHeight;
      setContentHeight(prev => prev !== newContentHeight ? newContentHeight : prev);
    }
  }, []);

  // Initial measurement on mount and dependency changes
  useEffect(() => {
    measureDimensions();
  }, [measureDimensions, ...dependencies]);

  // Use ResizeObserver for precise dimension tracking
  useEffect(() => {
    if (!window.ResizeObserver) {
      // Fallback to interval-based measurement for older browsers
      const measureInterval = setInterval(measureDimensions, 500);
      return () => clearInterval(measureInterval);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      measureDimensions();
    });

    if (panelRef.current) {
      resizeObserver.observe(panelRef.current);
    }
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [measureDimensions, ...dependencies]); // Re-observe when dependencies change

  // Window resize listener
  useEffect(() => {
    const handleResize = () => measureDimensions();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [measureDimensions]);

  return {
    panelRef,
    contentRef,
    panelHeight,
    contentHeight,
    measureDimensions
  };
}
