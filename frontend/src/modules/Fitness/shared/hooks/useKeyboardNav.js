import { useEffect, useCallback } from 'react';

const useKeyboardNav = ({
  onUp,
  onDown,
  onLeft,
  onRight,
  onEnter,
  onBack,
  enabled = true,
  preventDefault = true
}) => {
  const handleKeyDown = useCallback((e) => {
    if (!enabled) return;

    switch (e.key) {
      case 'ArrowUp':
        if (onUp) {
          if (preventDefault) e.preventDefault();
          onUp();
        }
        break;
      case 'ArrowDown':
        if (onDown) {
          if (preventDefault) e.preventDefault();
          onDown();
        }
        break;
      case 'ArrowLeft':
        if (onLeft) {
          if (preventDefault) e.preventDefault();
          onLeft();
        }
        break;
      case 'ArrowRight':
        if (onRight) {
          if (preventDefault) e.preventDefault();
          onRight();
        }
        break;
      case 'Enter':
      case ' ':
        if (onEnter) {
          if (preventDefault) e.preventDefault();
          onEnter();
        }
        break;
      case 'Escape':
      case 'Backspace':
        if (onBack) {
          if (preventDefault) e.preventDefault();
          onBack();
        }
        break;
      default:
        break;
    }
  }, [enabled, onUp, onDown, onLeft, onRight, onEnter, onBack, preventDefault]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
};

export default useKeyboardNav;
