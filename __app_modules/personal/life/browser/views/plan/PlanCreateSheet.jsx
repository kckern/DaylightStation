import { Group, Stack } from '@mantine/core';
import { Button, Sheet, StateMessage, SubmitButton, createAppLogger, useSheetSubmission } from '@/lib/ui';

const logger = createAppLogger('life').child('plan-create');

export function PlanCreateSheet({ noun, onClose, save, valid, children }) {
  const title = 'Add ' + noun;
  const { submit, saving, failure } = useSheetSubmission(onClose, error => {
    logger.warn('create.failed', { kind: noun, error: error?.message });
  });

  return (
    <Sheet open onClose={onClose} title={title}>
      <Stack component="form" aria-label={title} gap="sm" onSubmit={event => submit(event, save, valid)}>
        {failure && (
          <StateMessage state="error" role="alert" title={"Couldn't create the " + noun} detail={failure.message} />
        )}
        {children}
        <Group justify="flex-end">
          <Button density="compact" variant="secondary" onClick={onClose}>Cancel</Button>
          <SubmitButton density="compact" disabled={!valid} pending={saving}>
            {saving ? 'Creating…' : 'Create ' + noun}
          </SubmitButton>
        </Group>
      </Stack>
    </Sheet>
  );
}
