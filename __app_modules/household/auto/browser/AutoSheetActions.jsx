import { Button, StateMessage } from '@/lib/ui';

export function AutoSheetActions({ failure, onCancel, saving, valid = true }) {
  return (
    <>
      {failure && <StateMessage state="error" role="alert" title="Could not save" detail={failure.message} />}
      <div className="auto-sheet__actions">
        <Button density="compact" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          density="compact"
          disabled={!valid && !saving}
          aria-busy={saving || undefined}
          aria-disabled={saving || undefined}
          onClick={event => {
            if (saving) event.preventDefault();
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}
