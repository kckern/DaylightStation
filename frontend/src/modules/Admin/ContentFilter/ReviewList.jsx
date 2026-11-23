import { useState } from 'react';
import { EffectMenu } from './EffectMenu.jsx';
import { ActionIcon, Checkbox, Group, Popover, Select, Stack, Text, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { IconHelp } from '@tabler/icons-react';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { DEFAULT_SCOPE, ORDER_SCOPES, plays, scopeRows } from './reviewScope.js';
import { ChannelIcon, EffectIcon, LEGEND, RefiningIcon, StatusIcon, TimingIcon, timingState } from './partVisuals.jsx';

/**
 * The film's parts beside the player, for the rail tab in hand (ReviewRail.jsx sets the scope's
 * `stage`): the parts refine still has to pin, the filtered parts (the review), or the ones that
 * play (browse only). A part is one line (owner, 2026-11-22: "more compact, better icon usage"):
 * where it stands, its time, its effect and channel as icons (partVisuals.jsx), its label on one
 * line, and its timing as a small mark. A verdict keeps its word in view (Approved, Let play, Redo);
 * every icon carries its word as a tooltip, and the "?" in the header opens the icon key. The part in
 * hand opens to its whole label and the same facts in words, with its reasons and card.
 */
export const UNSURE_LABELS = {
  'refine-unknown': 'Timing unknown', 'refine-giveup': 'Timing not found', 'refine-coarse-edges': 'Rough edges',
  'refine-kept-manual': 'Kept manual timing', 'safe-window': 'Safe window', 'check-levels': 'Check levels',
  'exchange-by-length': 'Long line', 'untracked-visual': 'Not tracked', 'subject-unsure': 'Same subject?',
};
const GROUP_LABELS = {
  profanity: 'Profanity', blasphemy: 'Blasphemy', sexual: 'Sexual words', slurs: 'Slurs', childish: 'Childish',
  violence_blood_gore: 'Violence', sex_nudity_immodesty: 'Nudity', sex_any: 'Sexual content',
};
/** A group key in words: the known ones by name, the rest with spaces. */
export const groupLabel = (g) => GROUP_LABELS[g] || String(g || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** m:ss.s, or h:mm:ss.s from an hour on; tenths floored (a time code, not a rounded duration). */
export function timecode(t) {
  if (!Number.isFinite(t)) return '';
  const tenths = Math.floor(t * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  const sec = `${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}


/**
 * Where a part stands, as a word (owner, 2026-11-21: the icons alone said too little); `glyph` is
 * its plain-text mark and `tone` its colour class (the list draws the icon: partVisuals StatusIcon). A part that plays needs no verdict; one let play by a
 * verdict reads "Let play".
 */
export function rowStatus(r) {
  const v = r?.verdict?.verdict || (r?.reviewed ? 'approve' : null);
  if (v === 'approve') return { glyph: '✓', word: 'Approved', tone: 'done' };
  if (v === 'remove' || r?.why === 'removed') return { glyph: '×', word: 'Let play', tone: 'done' };
  if (v === 'ignore') return { glyph: '–', word: 'Ignored', tone: 'done' };
  if (v === 'redo') return { glyph: '↻', word: 'Redo', tone: 'redo' };
  if (plays(r)) return { glyph: '', word: 'Plays', tone: 'quiet' };
  // Reviewed or not, and nothing in between (owner, 2026-11-22: "verified or not"). A part refine
  // could not vouch for keeps that doubt on its timing icon, not in its status.
  return { glyph: '·', word: 'Not reviewed', tone: 'open' };
}

export function ReviewList({ rows = [], reviewed = 0, total = 0, audit = null, selectedId = null, onSelect = () => {}, onEffect = null,
  refining = {}, scope: scopeProp = null, onScope = null, emptyText = null }) {
  // The page owns the scope so the timeline and stepping share it; used on its own the list keeps its own.
  const [own, setOwn] = useState(DEFAULT_SCOPE);
  const [menuFor, setMenuFor] = useState(null);
  const scope = scopeProp || own;
  const setScope = (patch) => (onScope ? onScope({ ...scope, ...patch }) : setOwn({ ...scope, ...patch }));
  const shown = scopeRows(rows, scope, { refining });
  const stage = scope.stage || (scope.show === 'plays' ? 'plays' : 'review');
  const check = audit && !audit.fresh ? <Text size="xs" c="dimmed">{audit.running ? 'Checking…' : 'Check out of date'}</Text>
    : audit && !audit.ok ? <Text size="xs" c="red">The check has not passed</Text> : null;
  return (
    <Stack gap="xs" className="cf-review__list">
      <Group gap="xs" wrap="wrap" justify="space-between">
        {stage === 'refine' ? <Text size="xs" fw={600}>Rough or unsure timing</Text>
          // Nothing on Plays is "to do": the box would do nothing there.
          : stage === 'plays' ? <Text size="xs" fw={600}>Play as they are</Text>
          : <Checkbox size="xs" label="Not reviewed only" checked={scope.needs} onChange={(e) => setScope({ needs: e.currentTarget.checked })} />}
        {check}
        <Group gap={4} wrap="nowrap">
          <Select size="xs" w={160} aria-label="Order" allowDeselect={false} data={ORDER_SCOPES} value={scope.order || 'film'} onChange={(order) => setScope({ order: order || 'film' })} />
          <Popover position="bottom-end" withinPortal={false} shadow="md" width={250}>
            <Popover.Target><ActionIcon variant="subtle" color="gray" size="md" aria-label="Icon key"><IconHelp size={16} stroke={1.8} /></ActionIcon></Popover.Target>
            <Popover.Dropdown className="cf-legend">
              {LEGEND.map(([title, items]) => (
                <div key={title} className="cf-legend__group">
                  <Text size="xs" c="dimmed">{title}</Text>
                  {items.map(([icon, words]) => <div key={words} className="cf-legend__item">{icon}<span>{words}</span></div>)}
                </div>
              ))}
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Group>
      {!shown.length ? <Text size="sm" c="dimmed">{!rows.length && emptyText ? emptyText : stage === 'refine' ? 'Nothing is left to refine.' : 'Nothing here.'}</Text> : (
        <div className="cf-review__rows" role="list">
          {shown.map((r) => {
            const selected = r.id === selectedId;
            const timing = plays(r) ? null : timingState(r);
            const state = refining[r.id];
            const status = rowStatus(r);
            const fx = effectChip(r.effect);
            return (
              <div key={r.id} role="listitem" data-row-id={r.id} title={`${timecode(r.in)}–${timecode(r.out)}`}
                className={`cf-review__row${selected ? ' is-selected' : ''}${plays(r) ? ' is-plays' : ''}`}>
                <UnstyledButton onClick={() => onSelect(r)} onMouseDown={(e) => e.preventDefault()} aria-pressed={selected} aria-label={r.label}
                  className="cf-review__pick">
                  <span className="cf-review__glyph" data-status={status.word}><StatusIcon status={status} /></span>
                  <span className="cf-review__time">{timecode(r.in)}</span>
                  <span className="cf-review__label" title={r.label}>{r.label}</span>
                  <span className="cf-review__marks">
                    <span className={`cf-review__status is-${status.tone}`}>{status.word}</span>
                    {state ? <span className="cf-review__refining" title={state}><RefiningIcon state={state} /><VisuallyHidden>{state}</VisuallyHidden></span>
                      : timing ? <TimingIcon row={r} /> : null}
                  </span>
                </UnstyledButton>
                <span className="cf-review__fx">
                  {onEffect && !plays(r) ? (
                    <EffectMenu row={r} opened={menuFor === r.id} onChange={(o) => setMenuFor(o ? r.id : null)} position="bottom-end"
                      onPick={(letter) => onEffect(r, letter)}
                      target={(
                        <UnstyledButton className="cf-review__fx-btn" aria-label={`Effect: ${fx}`} title={`${fx}: click to change`}
                          onMouseDown={(e) => e.preventDefault()} onClick={() => { if (!selected) onSelect(r); }}>
                          <EffectIcon row={r} />
                        </UnstyledButton>
                      )} />
                  ) : <EffectIcon row={r} />}
                  <ChannelIcon row={r} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Stack>
  );
}

export default ReviewList;
