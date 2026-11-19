import { useRef } from 'react';
import { Center, Loader, Stack } from '@mantine/core';
import { ErrorState } from '../../../lib/ui/states.jsx';

export default function EditorReadRegion({ label, loading, error, errorTitle, reload, back, children }) {
  const region = useRef(null);
  const retry = () => {
    // Retry is about to remove its own button. Keep focus in the same editor
    // through loading and recovery, without moving it on a late response.
    region.current?.focus({ preventScroll: true });
    reload();
  };

  return (
    <section ref={region} aria-label={label} aria-busy={loading || undefined} tabIndex={-1}>
      {loading ? <Center h="60vh"><Loader size="lg" /></Center>
        : error ? (
          <Stack gap="md">
            {back}
            <ErrorState error={error} onRetry={retry} title={errorTitle} />
          </Stack>
        ) : children}
    </section>
  );
}
