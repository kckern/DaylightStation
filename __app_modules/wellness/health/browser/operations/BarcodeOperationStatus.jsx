import { useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { BUCKETS } from '../today/mealBuckets.js';
import { useHealthOperations } from './HealthOperationsProvider.jsx';

export function BarcodeOperationStatus({ open, onClose, onView, onUndo, undoBusy }) {
  const session = useHealthOperations();
  const [failure, setFailure] = useState(null);
  const operations = [...(session?.snapshot.operations.values() || [])]
    .filter(op => op.kind === 'barcode-commit').sort((a, b) => b.startedAt - a.startedAt);

  return <Sheet open={open} title="Health capture status" onClose={onClose}>
    {!operations.length && <Text>No barcode captures for this account.</Text>}
    {operations.map(op => {
      const receipt = op.receipt || (op.response?.committed && {
        entryId: op.response.entryIds?.[0], undoToken: op.response.undoToken,
      });
      const delivered = Boolean(receipt?.entryId);
      const meal = BUCKETS.find(bucket => bucket.id === op.bucket)?.label;
      return <section key={op.id}>
        <Text fw={600}>{['Barcode', meal, op.date].filter(Boolean).join(' · ')}</Text>
        <Text role="status">{op.reversed ? 'Undone' : delivered ? 'Delivered'
          : op.phase === 'conflict' ? 'This barcode could not be logged'
          : op.phase === 'error' ? 'Waiting to confirm delivery' : 'Processing'}</Text>
        {failure === op.id && <Text role="alert">Couldn’t confirm Undo. Check your connection and try again.</Text>}
        <Group>
          {op.phase === 'error' && <Button size="compact-sm" onClick={() => session.retry(op.id).catch(() => {})}>
            {delivered ? 'Retry refresh' : 'Retry'}
          </Button>}
          {delivered && !op.reversed && <>
            <Button size="compact-sm" variant="subtle" onClick={() => onView({ date: op.date, entryIds: [receipt.entryId] })}>
              View in Health
            </Button>
            {receipt.undoToken && <Button size="compact-sm" variant="subtle" loading={undoBusy} onClick={async () => {
              setFailure(null);
              const undone = await onUndo(receipt.undoToken, () => setFailure(op.id), `undo-${op.id}`);
              if (undone) session.store.transition(op.id, { reversed: true });
            }}>Undo</Button>}
          </>}
        </Group>
      </section>;
    })}
  </Sheet>;
}
