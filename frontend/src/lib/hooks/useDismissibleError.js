import { useCallback, useState } from 'react';

/** Hide the current error until a different error object arrives. */
export function useDismissibleError(error) {
  const [dismissed, setDismissed] = useState(null);
  const dismiss = useCallback(() => setDismissed(error), [error]);

  return {
    error: error != null && error !== dismissed ? error : null,
    dismiss,
  };
}

export default useDismissibleError;
