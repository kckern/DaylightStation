import { useEffect, useRef } from 'react';
import { Menu } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { effectOptions, isCurrentEffect } from './EffectMenu.jsx';
import { isSceneRow, plays } from './reviewScope.js';
import { timecode } from './ReviewList.jsx';

/**
 * The part menu (owner, 2026-11-22: "if I touch a segment or even use the context menu, I want
 * those to be rich, like right-click and I can change what it is or how it's handled"): a right-click
 * on a part anywhere it appears (the list, the timeline, the timing strip) or the context-menu key
 * on a list row. It names the part and offers what the card offers, each with its key: play it,
 * its effect, its verdict, refine, and its in and out points. The page takes the part in hand first,
 * so every item acts on that part through the same handlers as the keys.
 *
 * `onAction(action, value)`: play | unfiltered | jump | effect (value = letter) | settings |
 * verdict (value = approve | remove | redo) | refine | in | out.
 */
const membersOf = (r) => r?.members ?? (String(r?.id || '').startsWith('cue:') ? [r.peekId] : []);
/** One cue: the only kind of part whose in and out points the card sets (I / O). */
const singleCue = (r) => !isSceneRow(r) && membersOf(r).length === 1;

/** [key, label, action, value] for this part, by section. */
export function partMenuItems(row) {
  const playing = plays(row);
  const scene = isSceneRow(row);
  const play = [['↵', 'Play filtered', 'play'], ['W', 'Play unfiltered', 'unfiltered'], [null, 'Jump to it', 'jump']];
  const effects = effectOptions(row).map(([k, label, v]) => [k, label === 'Off' ? 'No effect' : label, 'effect', k.toLowerCase(), v]);
  const verdicts = playing ? [] : [['A', 'Approve', 'verdict', 'approve'], ['X', 'Let it play', 'verdict', 'remove'], ['D', 'Redo', 'verdict', 'redo']];
  const refine = playing || scene ? [] : [['R', 'Refine', 'refine']];
  const timing = playing || !singleCue(row) ? [] : [['I', 'Set in point here', 'in'], ['O', 'Set out point here', 'out']];
  return { play, effects, judge: [...verdicts, ...refine], timing };
}

export function PartMenu({ row, at = null, onClose = () => {}, onAction = () => {} }) {
  const opened = Boolean(row && at);
  const items = row ? partMenuItems(row) : null;
  const run = (action, value) => { onClose(); onAction(action, value); };
  const runRef = useRef(run);
  runRef.current = run;
  // The keys the items show work while the menu is open (the station's keys stand aside for an
  // open menu: useReviewKeys.js). A document listener, as in EffectMenu.jsx. Enter is Play filtered
  // (↵) unless an item has focus: then Mantine's Enter presses that item.
  useEffect(() => {
    if (!opened || !row) return undefined;
    const { play, effects, judge, timing } = partMenuItems(row);
    const letters = [...play, ...effects, ...judge, ...timing].filter(([k]) => k && /^[A-Z]$/.test(k));
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        if (document.activeElement?.closest?.('[role="menuitem"]')) return;
        e.preventDefault(); e.stopPropagation();
        runRef.current('play');
        return;
      }
      if (e.key.length !== 1) return;
      const hit = letters.find(([k]) => k.toLowerCase() === e.key.toLowerCase());
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      runRef.current(hit[2], hit[3]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opened, row]);
  if (!row) return null;
  const item = ([k, label, action, value, effect]) => {
    const current = action === 'effect' && isCurrentEffect(row, effect);
    return (
      <Menu.Item key={`${action}:${value ?? label}`} onClick={() => run(action, value)}
        {...(action === 'effect' ? { 'aria-checked': current } : {})}
        leftSection={action === 'effect' ? <span className="cf-fx-menu__check">{current ? <IconCheck size={14} /> : null}</span> : null}
        rightSection={k ? <kbd className="cf-keybar__key">{k}</kbd> : null}>
        {label}
      </Menu.Item>
    );
  };
  return (
    <Menu opened={opened} onChange={(o) => { if (!o) onClose(); }} position="bottom-start" withinPortal shadow="md" width={240}
      returnFocus={false} trapFocus closeOnItemClick={false}>
      <Menu.Target>
        <span className="cf-part-menu__anchor" aria-hidden="true"
          style={{ position: 'fixed', left: at?.x ?? 0, top: at?.y ?? 0, width: 1, height: 1, pointerEvents: 'none' }} />
      </Menu.Target>
      <Menu.Dropdown className="cf-fx-menu cf-part-menu" aria-label={`Part: ${row.label}`}>
        <Menu.Label className="cf-part-menu__title" title={row.label}>{`${row.label} · ${timecode(row.in)}–${timecode(row.out)}`}</Menu.Label>
        {items.play.map(item)}
        <Menu.Divider />
        <Menu.Label>Effect</Menu.Label>
        {items.effects.map(item)}
        {item([null, 'Use household settings', 'settings'])}
        {items.judge.length ? <><Menu.Divider />{items.judge.map(item)}</> : null}
        {items.timing.length ? <><Menu.Divider />{items.timing.map(item)}</> : null}
      </Menu.Dropdown>
    </Menu>
  );
}

export default PartMenu;
