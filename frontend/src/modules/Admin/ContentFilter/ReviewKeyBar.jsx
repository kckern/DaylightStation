import { Group, Stack, Text } from '@mantine/core';
import { Button } from '../../../lib/ui/Button.jsx';
import { Sheet } from '../../../lib/ui/Sheet.jsx';

const REDO_REASONS = [['1', 'edges'], ['2', 'category'], ['3', 'action'], ['4', 'timing']];
const KEYMAP = [
  ['Space', 'Play / pause the film'], ['Enter', 'Play this part with its effect (from 4 s before)'], ['W', 'Play this part unfiltered (the effect off)'], ['E', 'Open the effect menu'], ['S', 'Save timing (every dragged part)'],
  ['→ / ←', 'Next / previous part'], ['A', 'Approve (fine as it is)'], ['X', 'Let it play (take the filter off)'],
  ['D', 'Redo, then 1 edges, 2 category, 3 action, 4 timing, Enter no reason'], ['U', 'Undo the last verdict'],
  ['R', 'Refine this part (measure its timing)'], ['Shift+R', 'Refine every filtered part still on rough timing; confirms if any has hand-fixed timing'],
  ['M / P', 'Words: mute / bleep'], ['B / H / K', 'Picture: blur / hide picture / skip. Scenes: B hides the picture, K skips'], ['O', 'Effect off'],
  ['', 'An effect key applies the effect and replays the part; A approves it'],
  ['[ / ]', 'Bleep quieter / louder'], ['Shift+D', 'Re-refine every part marked Redo'],
  ['Tab', 'To a timing handle; then ← → move it 0.1 s (Shift 0.5 s), Home / End set it at the playhead'],
  ['Esc', 'Drop an unsaved timing change; leave a handle; close'], ['?', 'This list'],
];

const Key = ({ k, children }) => (
  <span className="cf-keybar__item"><kbd className="cf-keybar__key" data-key={k}>{k}</kbd> {children}</span>
);

/**
 * Under the part card: the redo prompt while D waits for a reason, the station's last message, the
 * preview retry, and the full keymap sheet (?). The everyday keys sit on the card's own buttons.
 */
export function ReviewKeyBar({ redoOpen = false, helpOpen = false, onCloseHelp, message = null, previewRecovery = null, onRedo = null }) {
  return (
    <div className="cf-keybar" aria-live="polite">
      {redoOpen ? (
        <Group gap="sm" wrap="wrap" align="center" role="toolbar" aria-label="Redo reason">
          <Text size="sm">Redo because:</Text>
          {/* The same prompt for D and for the Redo button: each reason is a key and a click. */}
          {REDO_REASONS.map(([k, label]) => (onRedo
            ? <button key={k} type="button" className="cf-keybar__pick" onMouseDown={(e) => e.preventDefault()} onClick={() => onRedo(label)}><Key k={k}>{label}</Key></button>
            : <Key key={k} k={k}>{label}</Key>))}
          {onRedo ? <button type="button" className="cf-keybar__pick" onMouseDown={(e) => e.preventDefault()} onClick={() => onRedo(undefined)}><Key k="Enter">no reason</Key></button> : <Key k="Enter">no reason</Key>}
          {onRedo ? <button type="button" className="cf-keybar__pick" onMouseDown={(e) => e.preventDefault()} onClick={() => onRedo(null)}><Key k="Esc">cancel</Key></button> : <Key k="Esc">cancel</Key>}
        </Group>
      ) : null}
      {message ? <Text size="sm" role="status" className="cf-keybar__message">{message}</Text> : null}
      {previewRecovery ? (
        <Group gap="xs">
          <Text size="sm" role="status">{previewRecovery.message}</Text>
          <Button density="compact" variant="secondary" keyHint="Enter" aria-keyshortcuts="Enter" aria-disabled={previewRecovery.retrying}
            aria-busy={previewRecovery.retrying} onClick={previewRecovery.retry}>Retry preview</Button>
        </Group>
      ) : null}
      <Sheet open={helpOpen} onClose={onCloseHelp} title="Review keys">
        <Stack gap="xs">
          {KEYMAP.map(([k, what], i) => (
            <div key={`${k}${i}`} className="cf-keybar__help-row">{k ? <kbd className="cf-keybar__key">{k}</kbd> : <span className="cf-keybar__key is-blank" />}<span>{what}</span></div>
          ))}
        </Stack>
      </Sheet>
    </div>
  );
}

export default ReviewKeyBar;
