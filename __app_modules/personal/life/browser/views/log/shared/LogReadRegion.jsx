import { useRetryRegion } from '@/lib/ui';
import { ErrorState, LoadingState } from '../../../components/index.js';

export function LogReadRegion({ read, children }) {
  const { loading, error, refetch } = read;
  const { regionProps, retry } = useRetryRegion(refetch, loading);

  return (
    <section {...regionProps} aria-label="Log results">
      {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={retry} /> : children}
    </section>
  );
}
