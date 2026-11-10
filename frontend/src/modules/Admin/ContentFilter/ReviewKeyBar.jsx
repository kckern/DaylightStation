import { Group, Text } from '@mantine/core';
import { actionKeysFor } from './reviewScope.js';

/**
 * The keys that apply right now, for the current row's kind, plus the verdict tally. `?` opens the
 * whole keymap. Pure display: useReviewKeys owns the keys.
 */
const REDO_REASONS = [['1', 'edges'], ['2', 'category'], ['3', 'action'], ['4', 'timing']];
const KEYMAP = [
  ['→ / Tab', 'Next part'], ['← / Shift+Tab', 'Previous part'], ['Space', 'Replay this part'],
  ['A', 'Approve (fine as it is)'], ['R', 'Remove (false positive)'], ['I', 'Ignore (no opinion)'],
  ['D', 'Redo, then 1 edges, 2 category, 3 action, 4 timing, Enter no reason'], ['U', 'Undo the last verdict'], ['Shift+D', 'Rework every row flagged redo'],
  ['F', 'Cycle the kind: all, words, picture, scenes'], ['M / P', 'Words: mute / bleep'],
  ['B / K', 'Picture: blur / skip. Scenes: hide picture / skip'], ['W', 'Widen 0.5 s each edge'],
  ['[ / ]', 'Bleep level down / up'], ['?', 'This list'], ['Esc', 'Close'],
];

const Key = ({ k, children }) => (
  <span className="cf-keybar__item"><kbd className="cf-keybar__key" data-key={k}>{k}</kbd> {children}</span>
);

export function ReviewKeyBar({ row = null, tally = { done: 0, total: 0, redo: 0 }, canUndo = false, redoOpen = false, helpOpen = false, message = null, bleepLevel = null }) {
  const tallyText = `${tally.done}/${tally.total}${tally.redo ? ` · ${tally.redo} redo` : ''}`;
  return (
    <div className="cf-keybar">
      <Group gap="sm" wrap="wrap" align="center" role="toolbar" aria-label="Review keys">
        <Text size="sm" fw={600} className="cf-keybar__tally">{tallyText}</Text>
        {redoOpen ? (
          <>
            <Text size="sm">Redo because:</Text>
            {REDO_REASONS.map(([k, label]) => <Key key={k} k={k}>{label}</Key>)}
            <Key k="Enter">no reason</Key><Key k="Esc">cancel</Key>
          </>
        ) : (
          <>
            <Key k="→">next</Key>
            {row ? (
              <>
                <Key k="Space">replay</Key>
                <Key k="A">approve</Key><Key k="R">remove</Key><Key k="I">ignore</Key><Key k="D">redo</Key>
                {actionKeysFor(row.kind).map(([k, label]) => <Key key={k} k={k}>{label.toLowerCase()}</Key>)}
                <Key k="W">widen</Key>
                {canUndo ? <Key k="U">undo</Key> : null}
              </>
            ) : null}
            {bleepLevel != null ? <Key k="[ ]">{`bleep ${Math.round(bleepLevel * 100)}%`}</Key> : null}
            <Key k="F">view</Key><Key k="?">all keys</Key>
          </>
        )}
      </Group>
      {message ? <Text size="sm" role="status" className="cf-keybar__message">{message}</Text> : null}
      {helpOpen ? (
        <div role="dialog" aria-label="Review keys" className="cf-keybar__help">
          <Text fw={600} size="sm">Keys</Text>
          {KEYMAP.map(([k, what]) => (
            <div key={k} className="cf-keybar__help-row"><kbd className="cf-keybar__key">{k}</kbd><span>{what}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ReviewKeyBar;
