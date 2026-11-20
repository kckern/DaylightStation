import { useRef, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Stack } from '@mantine/core';
import { useRetryRegion } from '../../../../frontend/src/lib/ui/useRetryRegion.js';
import { useSheetSubmission } from '../../../../frontend/src/lib/ui/useSheetSubmission.js';
import { ListReadError } from './ListReadError.jsx';

const normalize = value => typeof value === 'string' ? value.trim() : value;

function buildSettingsPatch(values, confirmed, defaults) {
  const patch = {};
  for (const [field, raw] of Object.entries(values)) {
    const value = normalize(raw);
    const configured = value != null && value !== '' && !Object.is(value, defaults[field]);
    // The endpoints merge their payloads. Restoring a default must send it.
    if (configured || !Object.is(value, normalize(confirmed[field]))) patch[field] = value;
  }
  return patch;
}

// Mount once per open visit. Confirmed fields come from the list owner, and
// this form keeps only edits that have yet to be acknowledged.
export function SettingsDialogForm({
  source, confirmed, defaults, loading, read, recoveryLabel, onSave, onClose, saveLabel, saveTestId, children,
}) {
  const [edits, setEdits] = useState({});
  const [acknowledged, setAcknowledged] = useState(null);
  const submission = useRef(null);
  const { run, saving, failure } = useSheetSubmission(onClose);
  const { regionProps, retry } = useRetryRegion(read.retry, read.loading && Boolean(read.error));
  // A refused readback leaves the previous snapshot in place. Keep the
  // acknowledged fields visible until the owner publishes a newer snapshot.
  const baseline = acknowledged && acknowledged.source === source ? acknowledged.values : confirmed;
  const values = { ...baseline, ...edits };
  const blocked = loading || Boolean(read.error);

  function change(field, value) {
    const pending = submission.current;
    if (pending) {
      if (Object.is(value, pending.values[field])) delete pending.later[field];
      else pending.later[field] = value;
    }
    setEdits(current => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (blocked) return;
    const submitted = { values, later: {} };
    return run(async () => {
      submission.current = submitted;
      try {
        const result = await onSave(buildSettingsPatch(submitted.values, baseline, defaults));
        if (result.error) throw result.error;
        return result;
      } finally {
        submission.current = null;
      }
    }, {
      onSuccess(result) {
        if (!result.ok) return;
        setAcknowledged(result.snapshotFailed ? { source, values: submitted.values } : null);
        setEdits(submitted.later);
        if (Object.keys(submitted.later).length === 0) onClose();
      },
    });
  }

  const unavailable = blocked || saving;
  return (
    <form onSubmit={submit}>
      <Box component="section" aria-label={recoveryLabel} mb={read.error ? 'md' : 0} {...regionProps}>
        <ListReadError error={read.error} reading={read.loading} onRetry={retry} />
      </Box>
      <Stack>
        {failure && <Alert color="red" title="Could not save settings">{failure.message}</Alert>}
        {children(values, change)}
        <Group justify="flex-end" mt="md">
          <Button type="button" variant="subtle" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            aria-disabled={unavailable || undefined}
            data-disabled={unavailable || undefined}
            aria-busy={saving || undefined}
            leftSection={saving ? <Loader size="xs" aria-hidden="true" /> : undefined}
            data-testid={saveTestId}
          >
            {saveLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
