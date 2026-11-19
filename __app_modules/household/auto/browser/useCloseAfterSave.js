import { useLayoutEffect, useRef } from 'react';

// A save can finish after its editor has been dismissed. Its acknowledgement
// still refreshes the records, but only the editor that started it may close.
export function useCloseAfterSave(onClose) {
  const open = useRef(false);
  useLayoutEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);

  return () => {
    if (open.current) onClose();
  };
}
