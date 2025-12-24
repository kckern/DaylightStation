import { useState, useEffect, useRef } from 'react';

const useResponsiveSize = ({
  debounce = 100,
  onResize
} = {}) => {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let timeoutId;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;

      if (debounce > 0) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setSize({ width, height });
          onResize?.({ width, height });
        }, debounce);
      } else {
        setSize({ width, height });
        onResize?.({ width, height });
      }
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, [debounce, onResize]);

  return { ref, width: size.width, height: size.height };
};

export default useResponsiveSize;
