import { useState } from 'react';
import { Badge, Checkbox, Group, SegmentedControl, Select, Stack, Text, UnstyledButton } from '@mantine/core';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { DEFAULT_SCOPE, ORDER_SCOPES, SHOW_SCOPES, plays, scopeRows } from './reviewScope.js';

/**
 * The film's parts beside the player: the Filtered tab (the review; default) or Plays (browse
 * only). Rows wrap to show their whole label; the part in hand opens to its span, reasons and card.
 * A glyph says where each stands: ▶ in hand, ✓ approved, × let it play, ↻ redo, · to do.
 */
export const UNSURE_LABELS = {
  'refine-unknown': 'Timing unknown', 'refine-giveup': 'Timing not found', 'refine-coarse-edges': 'Rough edges',
  'refine-kept-manual': 'Kept manual timing', 'safe-window': 'Safe window', 'check-levels': 'Check levels',
  'exchange-by-length': 'Long line', 'untracked-visual': 'Not tracked', 'subject-unsure': 'Same subject?',
};
const MODALITY = { said: 'said', shown: 'shown', heard: 'heard' };
const GROUP_LABELS = {
  profanity: 'Profanity', blasphemy: 'Blasphemy', sexual: 'Sexual words', slurs: 'Slurs', childish: 'Childish',
  violence_blood_gore: 'Violence', sex_nudity_immodesty: 'Nudity', sex_any: 'Sexual content',
};
/** A group key in words: the known ones by name, the rest with spaces. */
export const groupLabel = (g) => GROUP_LABELS[g] || String(g || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const VERDICT_BADGE = { approve: ['Approved', 'green'], remove: ['Let it play', 'gray'], ignore: ['Ignored', 'gray'], redo: ['Redo', 'orange'] };

/** m:ss.s, tenths floored (a time code, not a rounded duration). */
export function timecode(t) {
  if (!Number.isFinite(t)) return '';
  const tenths = Math.floor(t * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}


const TIMING = { refined: ['Refined', 'green'], 'safe-window': ['Safe window', 'yellow'], rough: ['Rough', 'orange'] };
const GLYPH = { approve: '✓', remove: '×', ignore: '–', redo: '↻' };

export function ReviewList({ rows = [], reviewed = 0, total = 0, audit = null, selectedId = null, onSelect = () => {},
  refining = {}, scope: scopeProp = null, onScope = null, emptyText = null }) {
  // The page owns the scope so the timeline and stepping share it; used on its own the list keeps its own.
  const [own, setOwn] = useState(DEFAULT_SCOPE);
  const scope = scopeProp || own;
  const setScope = (patch) => (onScope ? onScope({ ...scope, ...patch }) : setOwn({ ...scope, ...patch }));
  const playing = rows.filter(plays).length;
  const counts = { filtered: rows.length - playing, plays: playing };
  const shown = scopeRows(rows, scope);
  return (
    <Stack gap="xs" className="cf-review__list">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <SegmentedControl size="xs" aria-label="Show"
          data={SHOW_SCOPES.map((o) => ({ value: o.value, label: `${o.label} ${counts[o.value]}` }))}
          value={scope.show === 'plays' ? 'plays' : 'filtered'} onChange={(show) => setScope({ show })} />
        {audit && !audit.fresh ? <Text size="xs" c="dimmed">{audit.running ? 'Checking…' : 'Check out of date'}</Text>
          : audit && !audit.ok ? <Text size="xs" c="red">The check has not passed</Text> : null}
      </Group>
      <Group gap="xs" wrap="wrap" justify="space-between">
        <Checkbox size="xs" label="To do only" checked={scope.needs} onChange={(e) => setScope({ needs: e.currentTarget.checked })} />
        <Select size="xs" w={170} aria-label="Order" allowDeselect={false} data={ORDER_SCOPES} value={scope.order || 'film'} onChange={(order) => setScope({ order: order || 'film' })} />
      </Group>
      {scope.show === 'plays' ? <Text size="xs" c="dimmed">These play as they are under your settings. Nothing here needs a verdict.</Text>
        : <Text size="xs" c="dimmed">{`${reviewed} of ${total} reviewed`}</Text>}
      {!shown.length ? <Text size="sm" c="dimmed">{!rows.length && emptyText ? emptyText : 'Nothing here.'}</Text> : (
        <div className="cf-review__rows" role="list">
          {shown.map((r) => {
            const selected = r.id === selectedId;
            const timing = TIMING[r.timing];
            const state = refining[r.id];
            const glyph = selected ? '▶' : (r.verdict && GLYPH[r.verdict.verdict]) || (r.reviewed ? '✓' : plays(r) ? '' : '·');
            return (
              <div key={r.id} role="listitem" data-row-id={r.id}
                className={`cf-review__row${selected ? ' is-selected' : ''}${plays(r) ? ' is-plays' : ''}`}>
                <UnstyledButton onClick={() => onSelect(r)} onMouseDown={(e) => e.preventDefault()} aria-pressed={selected} aria-label={r.label}
                  className="cf-review__pick" title={selected ? undefined : r.label}>
                  <span className="cf-review__glyph" aria-hidden="true">{glyph}</span>
                  <span className="cf-review__time">{timecode(r.in)}</span>
                  <span className="cf-review__label">
                    <Text fw={500} size="sm" span>{r.label}</Text>
                  </span>
                  <span className="cf-review__meta">
                    <Text size="xs" c="dimmed" span>{[r.group && groupLabel(r.group), plays(r) ? (r.why === 'removed' ? 'plays (removed)' : 'plays') : effectChip(r.effect).toLowerCase()].filter(Boolean).join(' · ')}</Text>
                    {state ? <Badge size="xs" color="blue" variant="light">{state}</Badge>
                      : timing && r.timing !== 'refined' && !plays(r) ? <Badge size="xs" variant="light" color={timing[1]}>{timing[0]}</Badge> : null}
                    {r.verdict && VERDICT_BADGE[r.verdict.verdict] ? <Badge size="xs" variant="light" color={VERDICT_BADGE[r.verdict.verdict][1]}>{VERDICT_BADGE[r.verdict.verdict][0]}</Badge> : null}
                  </span>
                  {selected ? (
                    <span className="cf-review__more">
                      <Text size="xs" c="dimmed" span>{`${timecode(r.in)}–${timecode(r.out)}${MODALITY[r.modality] ? ` · ${MODALITY[r.modality]}` : ''}${r.handFixed ? ' · hand-fixed' : ''}`}</Text>
                      {r.unsure.filter((u) => !(u === 'safe-window' && r.timing === 'safe-window')).map((u) => <Badge key={u} size="xs" color="orange" variant="light">{UNSURE_LABELS[u] || u}</Badge>)}
                      {r.card ? <Text size="xs" c="dimmed" span>{r.card.approved ? 'Card: ' : 'Draft card: '}{r.card.text}</Text> : null}
                    </span>
                  ) : null}
                </UnstyledButton>
              </div>
            );
          })}
        </div>
      )}
    </Stack>
  );
}

export default ReviewList;
