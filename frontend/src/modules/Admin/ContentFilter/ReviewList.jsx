import { useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Group, SegmentedControl, Select, Stack, Text, UnstyledButton } from '@mantine/core';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';

/**
 * Every part the filter acts on in one film, as the household gets it (the latest audit's rows),
 * machine-unsure first. Play with the effect (4 s lead) or without it, and pick a row to handle.
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
const KINDS = [{ label: 'All', value: 'all' }, { label: 'Words', value: 'words' }, { label: 'Picture', value: 'picture' }, { label: 'Scenes', value: 'scenes' }];

/** m:ss.s, tenths floored (a time code, not a rounded duration). */
export function timecode(t) {
  if (!Number.isFinite(t)) return '';
  const tenths = Math.floor(t * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export function ReviewList({ rows = [], reviewed = 0, total = 0, audit = null, selectedId = null, onSelect = () => {},
  picked = null, onPick = null, sentBack = {} }) {
  const [kind, setKind] = useState('all');
  const [group, setGroup] = useState(null);
  const [needs, setNeeds] = useState(false);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort(), [rows]);
  const shown = rows.filter((r) => (kind === 'all' || r.kind === kind) && (!group || r.group === group)
    && (!needs || !r.reviewed));
  return (
    <Stack gap="xs" className="cf-review__list">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fw={600}>{reviewed} of {total} reviewed</Text>
        {audit && !audit.fresh ? <Text size="sm" c="dimmed">{audit.running ? 'Audit running…' : 'Audit out of date'}</Text>
          : audit && !audit.ok ? <Text size="sm" c="red">The audit has not passed</Text> : null}
      </Group>
      <Group gap="xs" wrap="wrap">
        <SegmentedControl size="xs" data={KINDS} value={kind} onChange={setKind} aria-label="Kind" />
        <Select size="xs" aria-label="Group" placeholder="All groups" clearable data={groups.map((g) => ({ value: g, label: groupLabel(g) }))} value={group} onChange={setGroup} />
        <Checkbox size="xs" label="Needs review" checked={needs} onChange={(e) => setNeeds(e.currentTarget.checked)} />
      </Group>
      {!shown.length ? <Text size="sm" c="dimmed">Nothing here. Change the filters above.</Text> : shown.map((r) => (
        <div key={r.id} data-row-id={r.id} className={`cf-review__row${r.id === selectedId ? ' is-selected' : ''}`}>
          <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
            <Stack gap={2} className="cf-review__row-main">
              <Group gap={6} wrap="wrap">
                {onPick && r.kind !== 'scenes' ? (
                  <Checkbox size="xs" aria-label={`Select ${r.label}`} checked={!!picked?.has(r.id)} onChange={(e) => onPick(r.id, e.currentTarget.checked)} />
                ) : null}
                {r.reviewed ? <Text span aria-label="Reviewed" className="cf-review__tick">✓</Text> : null}
                <UnstyledButton onClick={() => onSelect(r)} aria-pressed={r.id === selectedId} className="cf-review__pick">
                  <Text fw={500} size="sm" span>{r.label}</Text>
                </UnstyledButton>
                <Text size="xs" c="dimmed">{[r.group && groupLabel(r.group), MODALITY[r.modality]].filter(Boolean).join(', ')}</Text>
              </Group>
              <Group gap={6} wrap="wrap">
                <Text size="xs" className="cf-review__time">{timecode(r.in)}–{timecode(r.out)}</Text>
                <Badge size="xs" variant="light">{effectChip(r.effect)}</Badge>
                {r.handFixed ? <Badge size="xs" variant="outline">hand-fixed</Badge> : null}
                {sentBack[r.id] ? <Badge size="xs" color="blue" variant="light">Sent back: {sentBack[r.id]}</Badge> : null}
                {r.unsure.map((u) => <Badge key={u} size="xs" color="orange" variant="light">{UNSURE_LABELS[u] || u}</Badge>)}
              </Group>
              {r.card ? <Text size="xs" c="dimmed">{r.card.approved ? 'Card: ' : 'Draft card: '}{r.card.text}</Text> : null}
            </Stack>
            <Stack gap={4}>
              <Button size="compact-xs" variant="light" onClick={() => { onSelect(r); previewStore.jumpToCue({ in: r.in }); }}>Play with effect</Button>
              <Button size="compact-xs" variant="subtle" onClick={() => { onSelect(r); previewStore.peek(r.peekId); }}>Play without</Button>
            </Stack>
          </Group>
        </div>
      ))}
    </Stack>
  );
}

export default ReviewList;
