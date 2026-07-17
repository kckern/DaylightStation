import { Alert, Button, Group } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
export function ErrorState({ error, onRetry }) {
  return (
    <Alert color="red" title="Something went wrong" icon={<IconAlertCircle size={16} />}>
      {typeof error === 'string' ? error : (error?.message || 'Unexpected error')}
      {onRetry && (
        <Group mt="sm">
          <Button size="xs" variant="light" color="red" onClick={onRetry}>Try again</Button>
        </Group>
      )}
    </Alert>
  );
}
