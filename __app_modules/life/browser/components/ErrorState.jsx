import { ErrorState as DSErrorState } from '@/lib/ui';

/**
 * Thin adapter over the DS ErrorState.
 *
 * Every Life hook stores its caught error as a plain string (`err.message`),
 * not an Error object — but the DS component reads `error.message`, so a raw
 * string would always fall through to its "Unknown error" default. This
 * normalizes a string into the `{ message }` shape DS expects, which is the
 * only real prop mismatch between the two; `error`/`onRetry` otherwise pass
 * straight through.
 */
export function ErrorState({ error, onRetry, label }) {
  const normalized = typeof error === 'string' ? { message: error } : error;
  return <DSErrorState error={normalized} onRetry={onRetry} label={label} />;
}

export default ErrorState;
