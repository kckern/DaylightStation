import { useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Group, SegmentedControl, Select, Stack, Text, UnstyledButton } from '@mantine/core';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { ACTION_SCOPES, DEFAULT_SCOPE, KIND_SCOPES, SHOW_SCOPES, plays, scopeRows } from './reviewScope.js';

/**
 * Every part in one film (the latest audit's rows): the ones the filter acts on, as the household
 * gets them, machine-unsure first, then the ones it lets play. Each row says its timing (refined or
 * rough). Play with the effect (4 s lead) or without it, and pick a row to handle.
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
const VERDICT_BADGE = { approve: ['Approved', 'green'], remove: ['Removed', 'gray'], ignore: ['Ignored', 'gray'], redo: ['Redo', 'orange'] };

/** m:ss.s, tenths floored (a time code, not a rounded duration). */
export function timecode(t) {
  if (!Number.isFinite(t)) return '';
  const tenths = Math.floor(t * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

const TIMING = { refined: ['Refined', 'green'], rough: ['Rough timing', 'gray'] }; // safe-window shows as an unsure reason

export function ReviewList({ rows = [], reviewed = 0, total = 0, audit = null, selectedId = null, onSelect = () => {},
  picked = null, onPick = null, sentBack = {}, scope: scopeProp = null, onScope = null, emptyText = null }) {
  // The page owns the scope (show x kind x action x needs x group) so the timeline and stepping share
  // it; used on its own the list keeps its own.
  const [own, setOwn] = useState(DEFAULT_SCOPE);
  const scope = scopeProp || own;
  const setScope = (patch) => (onScope ? onScope({ ...scope, ...patch }) : setOwn({ ...scope, ...patch }));
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort(), [rows]);
  const playing = rows.filter(plays).length;
  const counts = { all: rows.length, filtered: rows.length - playing, plays: playing };
  const shown = scopeRows(rows, scope);
  // A film all on one timing says so in its meter; a chip per row only helps when it is mixed.
  const mixedTiming = new Set(rows.map((r) => r.timing).filter(Boolean)).size > 1;
  return (
    <Stack gap="xs" className="cf-review__list">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fw={600}>{reviewed} of {total} reviewed</Text>
        {audit && !audit.fresh ? <Text size="sm" c="dimmed">{audit.running ? 'Audit running…' : 'Audit out of date'}</Text>
          : audit && !audit.ok ? <Text size="sm" c="red">The audit has not passed</Text> : null}
      </Group>
      {playing ? <Text size="xs" c="dimmed">{`${rows.length} parts in this film: the filter acts on ${counts.filtered}, ${playing} play as they are.`}</Text> : null}
      <SegmentedControl size="xs" fullWidth aria-label="Show"
        data={SHOW_SCOPES.map((o) => ({ value: o.value, label: `${o.label} ${counts[o.value]}` }))}
        value={scope.show || 'all'} onChange={(show) => setScope({ show })} />
      <Group gap="xs" wrap="wrap">
        <SegmentedControl size="xs" data={KIND_SCOPES} value={scope.kind} onChange={(kind) => setScope({ kind })} aria-label="Kind" />
        <Select size="xs" aria-label="Action" allowDeselect={false} data={ACTION_SCOPES} value={scope.action} onChange={(action) => setScope({ action: action || 'all' })} />
        <Select size="xs" aria-label="Group" placeholder="All groups" clearable data={groups.map((g) => ({ value: g, label: groupLabel(g) }))} value={scope.group} onChange={(group) => setScope({ group })} />
        <Checkbox size="xs" label="Needs review" checked={scope.needs} onChange={(e) => setScope({ needs: e.currentTarget.checked })} />
      </Group>
      {!shown.length ? <Text size="sm" c="dimmed">{!rows.length && emptyText ? emptyText : 'Nothing here. Change the filters above.'}</Text> : (
        <div className="cf-review__rows" role="list">
          {shown.map((r) => {
            const timing = mixedTiming ? TIMING[r.timing] : null;
            return (
              <div key={r.id} role="listitem" data-row-id={r.id}
                className={`cf-review__row${r.id === selectedId ? ' is-selected' : ''}${plays(r) ? ' is-plays' : ''}`}>
                <div className="cf-review__row-check">
                  {onPick && r.kind !== 'scenes' ? (
                    <Checkbox size="xs" aria-label={`Select ${r.label}`} checked={!!picked?.has(r.id)} onChange={(e) => onPick(r.id, e.currentTarget.checked)} />
                  ) : null}
                </div>
                <UnstyledButton onClick={() => onSelect(r)} onMouseDown={(e) => e.preventDefault()} aria-pressed={r.id === selectedId} aria-label={r.label}
                  className="cf-review__pick" title={r.label}>
                  <span className="cf-review__time">{timecode(r.in)}</span>
                  <span className="cf-review__label">
                    {r.reviewed ? <Text span aria-label="Reviewed" className="cf-review__tick">✓ </Text> : null}
                    <Text fw={500} size="sm" span>{r.label}</Text>
                  </span>
                  <span className="cf-review__meta">
                    <Text size="xs" c="dimmed" span>{[r.group && groupLabel(r.group), MODALITY[r.modality], `${timecode(r.in)}–${timecode(r.out)}`].filter(Boolean).join(' · ')}</Text>
                  </span>
                </UnstyledButton>
                <div className="cf-review__chips">
                  {plays(r) ? <Badge size="xs" variant="outline" color="gray">Plays</Badge> : <Badge size="xs" variant="light">{effectChip(r.effect)}</Badge>}
                  {r.verdict && VERDICT_BADGE[r.verdict.verdict] ? <Badge size="xs" variant="light" color={VERDICT_BADGE[r.verdict.verdict][1]}>{VERDICT_BADGE[r.verdict.verdict][0]}</Badge> : null}
                  {timing ? <Badge size="xs" variant="dot" color={timing[1]}>{timing[0]}</Badge> : null}
                  {r.handFixed ? <Badge size="xs" variant="outline">hand-fixed</Badge> : null}
                  {sentBack[r.id] ? <Badge size="xs" color="blue" variant="light">Sent back: {sentBack[r.id]}</Badge> : null}
                  {r.unsure.map((u) => <Badge key={u} size="xs" color="orange" variant="light">{UNSURE_LABELS[u] || u}</Badge>)}
                </div>
                <div className="cf-review__play">
                  <Button size="compact-xs" variant="light" aria-label="Play with effect" title="Play with effect"
                    onMouseDown={(e) => e.preventDefault()} onClick={() => onSelect(r)}>▶</Button>
                  {plays(r) ? null : (
                    <Button size="compact-xs" variant="subtle" aria-label="Play without" title="Play without the effect"
                      onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelect(r, { seek: false }); previewStore.peek(r.peekId); }}>Without</Button>
                  )}
                </div>
                {r.card ? <Text size="xs" c="dimmed" className="cf-review__card">{r.card.approved ? 'Card: ' : 'Draft card: '}{r.card.text}</Text> : null}
              </div>
            );
          })}
        </div>
      )}
    </Stack>
  );
}

export default ReviewList;
