import { Button, SubmitButton, StateMessage } from '@/lib/ui';

export function AutoSheetActions({ failure, onCancel, saving, valid = true }) {
  return (
    <>
      {failure && <StateMessage state="error" role="alert" title="Could not save" detail={failure.message} />}
      <div className="auto-sheet__actions">
        <Button density="compact" variant="secondary" onClick={onCancel}>Cancel</Button>
        <SubmitButton density="compact" disabled={!valid} pending={saving}>
          {saving ? 'Saving…' : 'Save'}
        </SubmitButton>
      </div>
    </>
  );
}
