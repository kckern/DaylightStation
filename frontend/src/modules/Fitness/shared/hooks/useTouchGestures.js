import { useRef, useEffect } from 'react';

const useTouchGestures = ({
  onTap,
  onDoubleTap,
  onSwipe,
  onPinch,
  onLongPress,
  ref: externalRef
} = {}) => {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;
  
  // State refs to track gestures without re-renders
  const state = useRef({
    startX: 0,
    startY: 0,
    lastTap: 0,
    isPinching: false,
    initialPinchDistance: 0,
    longPressTimer: null
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        state.current.startX = touch.clientX;
        state.current.startY = touch.clientY;
        
        // Long press detection
        state.current.longPressTimer = setTimeout(() => {
          onLongPress?.({ x: touch.clientX, y: touch.clientY });
        }, 500);
      } else if (e.touches.length === 2) {
        // Pinch start
        state.current.isPinching = true;
        state.current.initialPinchDistance = getDistance(e.touches);
        clearTimeout(state.current.longPressTimer);
      }
    };

    const handleTouchMove = (e) => {
      // Cancel long press on move
      clearTimeout(state.current.longPressTimer);

      if (state.current.isPinching && e.touches.length === 2) {
        const currentDistance = getDistance(e.touches);
        const scale = currentDistance / state.current.initialPinchDistance;
        onPinch?.(scale);
        e.preventDefault(); // Prevent zoom
      }
    };

    const handleTouchEnd = (e) => {
      clearTimeout(state.current.longPressTimer);
      state.current.isPinching = false;

      if (e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - state.current.startX;
        const deltaY = touch.clientY - state.current.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Swipe detection
        if (absX > 50 || absY > 50) {
          if (absX > absY) {
            onSwipe?.(deltaX > 0 ? 'right' : 'left', Math.abs(deltaX));
          } else {
            onSwipe?.(deltaY > 0 ? 'down' : 'up', Math.abs(deltaY));
          }
        } else if (absX < 10 && absY < 10) {
          // Tap detection
          const now = Date.now();
          if (now - state.current.lastTap < 300) {
            onDoubleTap?.({ x: touch.clientX, y: touch.clientY });
            state.current.lastTap = 0;
          } else {
            state.current.lastTap = now;
            onTap?.({ x: touch.clientX, y: touch.clientY });
          }
        }
      }
    };

    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onTap, onDoubleTap, onSwipe, onPinch, onLongPress, ref]);

  return { ref };
};

export default useTouchGestures;
