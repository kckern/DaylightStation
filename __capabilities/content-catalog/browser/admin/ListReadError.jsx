import { Alert, Button, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

export function ListReadError({ error, reading, onRetry }) {
  if (!error) return null;
  return (
    <Alert icon={<IconAlertCircle size={16} />} color="red"
      title={error.afterSave ? 'Change saved. Could not refresh the list.' : 'Could not load the list'}>
      <Text>{error.error.message}</Text>
      {reading ? <Text>Loading list…</Text> : <Button type="button" variant="light" onClick={onRetry}>Retry</Button>}
    </Alert>
  );
}
