import { useLayoutEffect, useRef, useState } from 'react';

// Mount once per sheet visit. The save owns its write and invalidation.
// Only the mounted sheet that submitted it receives close and error state.
export function useSheetSubmission(onClose, onError) {
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = async (event, save, valid = true) => {
    event.preventDefault();
    if (!mounted.current || inFlight.current || !valid) return;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await save();
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) setFailure(error);
      onError(error);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return { submit, saving, failure };
}
