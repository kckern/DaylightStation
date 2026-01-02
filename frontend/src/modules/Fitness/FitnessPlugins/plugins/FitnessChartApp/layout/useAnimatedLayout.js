import { useState, useEffect, useRef } from 'react';

/**
 * Hook to animate layout changes smoothly.
 * 
 * @param {Array} targetElements - The desired final state of elements
 * @param {Object} options - Animation configuration
 * @param {number} options.duration - Animation duration in ms (default: 150)
 * @param {boolean} options.enabled - Whether animation is enabled (default: true)
 * @returns {Array} - The current interpolated state of elements
 */
export const useAnimatedLayout = (targetElements, options = {}) => {
  const { duration = 150, enabled = true, animateBasePosition = false } = options;
  
  // If disabled, just return targets immediately
  if (!enabled) return targetElements;

  const [displayElements, setDisplayElements] = useState(targetElements);
  const animationRef = useRef(null);
  const startTimeRef = useRef(null);
  const startElementsRef = useRef(targetElements);
  const targetElementsRef = useRef(targetElements);

  // Easing function: Ease Out Cubic
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  useEffect(() => {
    // If targets haven't changed deeply, do nothing
    // Simple check: length and IDs and positions
    // For performance, we might trust the caller to memoize targetElements,
    // but let's do a quick check to avoid unnecessary animations if values are identical.
    const isSame = targetElements.length === targetElementsRef.current.length &&
      targetElements.every((t, i) => {
        const c = targetElementsRef.current[i];
        return t.id === c.id && 
               Math.abs(t.x - c.x) < 0.1 && 
               Math.abs(t.y - c.y) < 0.1 &&
               Math.abs((t.offsetX || 0) - (c.offsetX || 0)) < 0.1 &&
               Math.abs((t.offsetY || 0) - (c.offsetY || 0)) < 0.1;
      });

    if (isSame) return;

    // Start new animation
    startElementsRef.current = displayElements; // Start from CURRENT display state (interrupted animation support)
    targetElementsRef.current = targetElements;
    startTimeRef.current = performance.now();

    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const animate = (now) => {
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);

      if (progress >= 1) {
        setDisplayElements(targetElements);
        animationRef.current = null;
        return;
      }

      // Interpolate
      const nextElements = targetElements.map(target => {
        // Find corresponding start element
        const start = startElementsRef.current.find(s => s.id === target.id);
        
        if (!start) {
          // New element: appear instantly at target (or fade in if we supported opacity)
          return target;
        }

        // Interpolate positions
        // If animateBasePosition is false (default), snap x/y to target immediately
        // This ensures avatars stay attached to line tips which update instantly
        const currentX = animateBasePosition ? start.x + (target.x - start.x) * eased : target.x;
        const currentY = animateBasePosition ? start.y + (target.y - start.y) * eased : target.y;
        
        // Always animate offsets (collision resolution)
        const currentOffsetX = (start.offsetX || 0) + ((target.offsetX || 0) - (start.offsetX || 0)) * eased;
        const currentOffsetY = (start.offsetY || 0) + ((target.offsetY || 0) - (start.offsetY || 0)) * eased;

        return {
          ...target,
          x: currentX,
          y: currentY,
          offsetX: currentOffsetX,
          offsetY: currentOffsetY
        };
      });

      // Handle exiting elements? 
      // For now, we just remove them instantly as per targetElements.
      // To animate exit, we'd need to keep them in the list but fade them out.
      // Let's stick to simple position interpolation for now.

      setDisplayElements(nextElements);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [targetElements, duration, animateBasePosition]);

  return displayElements;
};
