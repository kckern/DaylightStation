import { Group, Stack, Text } from '@mantine/core';
import { Button } from '../../../lib/ui/Button.jsx';
import { Sheet } from '../../../lib/ui/Sheet.jsx';

const REDO_REASONS = [['1', 'edges'], ['2', 'category'], ['3', 'action'], ['4', 'timing']];
const KEYMAP = [
  ['Space', 'Play / pause the film'], ['Enter', 'Play this part with its effect (from 4 s before)'], ['W', 'Play this part without the effect'],
  ['→ / ←', 'Next / previous part'], ['A', 'Approve (fine as it is)'], ['X', 'Let it play (take the filter off)'],
  ['D', 'Redo, then 1 edges, 2 category, 3 action, 4 timing, Enter no reason'], ['U', 'Undo the last verdict'],
  ['R', 'Refine this part (measure its timing)'], ['Shift+R', 'Refine every filtered part still on rough timing; confirms if any has hand-fixed timing'],
  ['M / P', 'Words: mute / bleep'], ['B / K', 'Picture: blur / skip. Scenes: hide picture / skip'], ['O', 'Effect off'],
  ['[ / ]', 'Bleep quieter / louder'], ['Shift+D', 'Rework every part marked redo'], ['?', 'This list'], ['Esc', 'Close'],
];

const Key = ({ k, children }) => (
  <span className="cf-keybar__item"><kbd className="cf-keybar__key" data-key={k}>{k}</kbd> {children}</span>
);

/**
 * Under the part card: the redo prompt while D waits for a reason, the station's last message, the
 * preview retry, and the full keymap sheet (?). The everyday keys sit on the card's own buttons.
 */
export function ReviewKeyBar({ redoOpen = false, helpOpen = false, onCloseHelp, message = null, previewRecovery = null }) {
  return (
    <div className="cf-keybar" aria-live="polite">
      {redoOpen ? (
        <Group gap="sm" wrap="wrap" align="center" role="toolbar" aria-label="Redo reason">
          <Text size="sm">Redo because:</Text>
          {REDO_REASONS.map(([k, label]) => <Key key={k} k={k}>{label}</Key>)}
          <Key k="Enter">no reason</Key><Key k="Esc">cancel</Key>
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
            <div key={`${k}${i}`} className="cf-keybar__help-row"><kbd className="cf-keybar__key">{k}</kbd><span>{what}</span></div>
          ))}
        </Stack>
      </Sheet>
    </div>
  );
}

export default ReviewKeyBar;
