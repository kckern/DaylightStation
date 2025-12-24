import { useState, useEffect, useRef } from 'react';

const useAnimatedNumber = (value, {
  duration = 500,
  easing = 'easeOut',
  format = (n) => Math.round(n)
} = {}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const startValue = useRef(value);
  const startTime = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    startValue.current = displayValue;
    startTime.current = null;
    
    const animate = (timestamp) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      
      // Easing functions
      let ease = progress;
      if (easing === 'easeOut') {
        ease = 1 - Math.pow(1 - progress, 3);
      } else if (easing === 'linear') {
        ease = progress;
      }
      
      const current = startValue.current + (value - startValue.current) * ease;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, easing]);

  return format(displayValue);
};

export default useAnimatedNumber;
