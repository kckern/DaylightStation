import { useLayoutEffect, useRef, useState } from 'react';

// A save can finish after its editor has been dismissed. Its acknowledgement
// still refreshes the records, but only the editor that started it may close.
export function useAutoSheetSave(onClose, onError) {
  const open = useRef(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  useLayoutEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);

  const submit = async (event, save, valid = true) => {
    event.preventDefault();
    if (!open.current || inFlight.current || !valid) return;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await save();
      if (open.current) onClose();
    } catch (error) {
      if (open.current) setFailure(error);
      onError(error);
    } finally {
      inFlight.current = false;
      if (open.current) setSaving(false);
    }
  };
  return { submit, saving, failure };
}
