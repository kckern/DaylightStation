import { Center, Loader, Stack } from '@mantine/core';
import { ErrorState } from '../../../lib/ui/states.jsx';
import { useRetryRegion } from '../../../lib/ui/useRetryRegion.js';

export default function EditorReadRegion({ label, loading, error, errorTitle, reload, back, children }) {
  const { regionProps, retry } = useRetryRegion(reload, loading);

  return (
    <section {...regionProps} aria-label={label}>
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
