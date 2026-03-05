import React, { useState, useCallback, useRef, useEffect } from 'react';

let showToastFn = null;

export function toast(message, { undo, duration = 3000 } = {}) {
  showToastFn?.({ message, undo, duration });
}

const Toast = () => {
  const [item, setItem] = useState(null);
  const timerRef = useRef(null);

  const dismiss = useCallback(() => {
    setItem(null);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const show = useCallback(({ message, undo, duration }) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setItem({ message, undo });
    timerRef.current = setTimeout(dismiss, duration);
  }, [dismiss]);

  useEffect(() => {
    showToastFn = show;
    return () => { showToastFn = null; };
  }, [show]);

  if (!item) return null;

  return (
    <div className="media-toast" onClick={dismiss}>
      <span>{item.message}</span>
      {item.undo && (
        <button className="media-toast-undo" onClick={(e) => { e.stopPropagation(); item.undo(); dismiss(); }}>
          Undo
        </button>
      )}
    </div>
  );
};

export default Toast;
