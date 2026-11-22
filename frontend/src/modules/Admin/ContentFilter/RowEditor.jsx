import { useEffect, useState } from 'react';
import { Badge, Button, Collapse, Group, SegmentedControl, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { fitEffectToChannel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { LANGUAGE_GROUPS } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { previewStore, effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { groupLabel, timecode } from './ReviewList.jsx';
import { actionKeysFor, isSceneRow, keysKindOf, plays } from './reviewScope.js';
import { whyLine } from './whyLine.js';

/**
 * The part in hand (ops design "cf-journey", owner 2026-11-21): where it sits in the queue, what it
 * is and why it gets its effect, Refine (R), the effect keys, a timing nudge, and the verdict keys.
 * Every button carries its key; the hint strip at the bottom is the rest of the keymap.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const CUE_EFFECTS = [['mute', 'Mute'], ['bleep', 'Bleep'], ['blur', 'Blur'], ['full-blur', 'Full blur'], ['skip', 'Skip']];
const WORD_CHOICES = [{ label: 'Use settings', value: 'profile' }, { label: 'Play this word', value: 'off' }, { label: 'Mute this word', value: 'mute' }, { label: 'Bleep this word', value: 'bleep' }];
const GROUP_CHOICES = [{ label: 'Play', value: 'off' }, { label: 'Mute', value: 'mute' }, { label: 'Bleep', value: 'bleep' }];
const STEPS = [-0.5, -0.1, 0.1, 0.5];
const VERDICT_BADGE = { approve: ['Approved', 'green'], remove: ['Let it play', 'gray'], ignore: ['Ignored', 'gray'], redo: ['Redo', 'orange'] };

/** R1: the cue effects that fit this channel as they are (tracked or not). */
export function effectChoices(modality) {
  const fits = (e) => fitEffectToChannel(e, modality, { hasRegions: true }) === e || fitEffectToChannel(e, modality, { hasRegions: false }) === e;
  return [{ label: 'Use settings', value: 'profile' }, { label: 'Off', value: 'off' },
    ...CUE_EFFECTS.filter(([e]) => fits(e)).map(([value, label]) => ({ label, value }))];
}

const Key = ({ k }) => <kbd className="cf-keybar__key">{k}</kbd>;

/** A button that shows its key. */
function KeyButton({ k, children, ...rest }) {
  return <Button size="compact-sm" {...rest}><span className="cf-card__btn">{children} <Key k={k} /></span></Button>;
}

export function RowEditor({ ratingKey, row, onChanged = () => {}, busyText = null, wordRulings = {},
  position = null, handlers = {}, refineState = null, canUndo = false }) {
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [span, setSpan] = useState([row.in, row.out]);
  const [cardText, setCardText] = useState(row.card?.text || '');
  const [more, setMore] = useState(false);
  useEffect(() => { setSpan([row.in, row.out]); setCardText(row.card?.text || ''); setNotice(null); }, [row.id, row.in, row.out, row.card?.text]);
  const disabled = Boolean(busyText) || Boolean(pending);
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const isScene = isSceneRow(row);
  const members = row.members ?? (String(row.id).startsWith('cue:') ? [row.peekId] : []);
  const single = isScene || members.length === 1;
  const isWord = row.modality === 'said' && LANGUAGE_GROUPS.includes(row.group);
  const why = whyLine(row);
  const playing = plays(row);

  const act = async (key, calls, done) => {
    setPending(key); setNotice(null);
    try {
      for (const [path, body, method] of calls) await DaylightAPI(path, body, method);
      logger.info('review.action', { ratingKey, row: row.id, key });
      if (done) setNotice(done);
      onChanged();
    } catch (err) {
      logger.warn('review.action_failed', { ratingKey, row: row.id, key, error: err.message });
      setNotice(err.message || 'That did not work.');
    } finally { setPending(null); }
  };
  const rule = (body) => (isScene
    ? [[`${base}/scenes/${encodeURIComponent(row.peekId)}`, body, 'PUT']]
    : members.map((id) => [`${base}/cues/${encodeURIComponent(id)}`, body, 'PUT']));
  const nudge = (value) => act('nudge', rule({ nudge: value }), value ? 'Timing saved.' : 'Hand fix dropped.');
  const at = (edge) => {
    const t = previewStore.currentTime();
    if (t == null) { setNotice('Play the film first.'); return; }
    setSpan((s) => (edge === 0 ? [t, s[1]] : [s[0], t]));
  };
  const step = (edge, d) => setSpan((s) => s.map((v, i) => (i === edge ? Math.round((v + d) * 1000) / 1000 : v)));
  const changed = span[0] !== row.in || span[1] !== row.out;
  const fits = isScene ? null : new Set(effectChoices(row.modality).map((o) => o.value));
  const effectKeys = actionKeysFor(keysKindOf(row)).filter(([, , v]) => isScene || fits.has(v));
  const refining = refineState?.state;
  const verdict = row.verdict?.verdict;

  return (
    <Stack gap={8} className="cf-card-part" aria-label="Part under review">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" c="dimmed" className="cf-focus__where">
          {position ? `Part ${position.index + 1} of ${position.total}` : 'Not in this list'} · {timecode(row.in)}–{timecode(row.out)}
        </Text>
        <Group gap={4} wrap="nowrap">
          <Button size="compact-sm" variant="default" onClick={handlers.prev} disabled={!position || position.index <= 0} aria-label="Previous part">‹ Prev</Button>
          <Button size="compact-sm" variant="default" onClick={handlers.next} disabled={position && position.index >= position.total - 1} aria-label="Next part">Next ›</Button>
        </Group>
      </Group>

      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Text fw={600} size="md" className="cf-card-part__title">{row.label}</Text>
        <Group gap={4} wrap="wrap" justify="flex-end" className="cf-card-part__chips">
          {playing ? <Badge size="sm" variant="outline" color="gray">{row.why === 'removed' ? 'Plays (removed)' : 'Plays'}</Badge> : <Badge size="sm" variant="light">{effectChip(row.effect)}</Badge>}
          {row.timing ? <Badge size="sm" variant="dot" color={row.timing === 'rough' ? 'orange' : 'green'}>{row.timing === 'rough' ? 'Rough timing' : row.timing === 'safe-window' ? 'Safe window' : 'Refined'}</Badge> : null}
          {row.handFixed ? <Badge size="sm" variant="outline">Hand-fixed</Badge> : null}
          {verdict && VERDICT_BADGE[verdict] ? <Badge size="sm" variant="light" color={VERDICT_BADGE[verdict][1]}>{VERDICT_BADGE[verdict][0]}</Badge> : null}
        </Group>
      </Group>
      <Text size="xs" c="dimmed">{[row.group && groupLabel(row.group), row.modality, row.category].filter(Boolean).join(' · ')}</Text>

      <Group justify="space-between" wrap="nowrap" align="center" gap="sm" className="cf-card-part__why">
        <Text size="sm">{why.text}</Text>
        {!isScene && !playing ? (
          refining ? <Badge size="md" color="blue" variant="light">{refining}</Badge> : (
            <KeyButton k="R" style={{ flexShrink: 0 }} variant={why.refine && row.timing === 'rough' ? 'filled' : 'light'} disabled={disabled} onClick={handlers.refine}>
              {row.timing === 'rough' ? 'Refine this part' : 'Refine again'}
            </KeyButton>
          )
        ) : null}
      </Group>

      <Group gap={6} wrap="wrap" align="center">
        <Text size="xs" c="dimmed" w={52}>Effect</Text>
        <Button size="compact-sm" variant={playing && row.why !== 'removed' ? 'filled' : 'default'} disabled={disabled}
          onClick={() => act('effect', rule({ effect: 'profile', disabled: false }))}>{playing && row.why !== 'removed' ? 'Settings (plays)' : 'Settings'}</Button>
        {effectKeys.map(([k, label, v]) => (
          <KeyButton key={k} k={k} variant={!playing && (row.effect === v || (v === 'skip' && row.effect === 'skip-card')) ? 'filled' : 'default'} disabled={disabled}
            onClick={() => handlers.effect?.(k.toLowerCase())}>{label}</KeyButton>
        ))}
      </Group>

      {row.effect === 'skip-card' || (isScene && row.card) ? (
        <Group gap="xs" wrap="wrap" align="flex-end">
          <TextInput size="xs" className="cf-editor__card" label={row.card?.approved ? 'Card (approved)' : 'Card shown in place of the skip'} maxLength={90}
            value={cardText} onChange={(e) => setCardText(e.currentTarget.value)} disabled={disabled} />
          <Button size="compact-xs" disabled={disabled || !cardText.trim()} onClick={() => act('card', rule({ card: { approve: true, text: cardText.trim() } }), 'Card approved.')}>Approve card</Button>
          <Button size="compact-xs" variant="subtle" disabled={disabled || !single}
            onClick={() => act('draft', [[isScene ? `${base}/scenes/${encodeURIComponent(row.peekId)}/card` : `${base}/cues/${encodeURIComponent(members[0])}/card`, {}, 'POST']], 'Card drafted.')}>Draft</Button>
          {row.card?.approved ? <Button size="compact-xs" variant="subtle" color="red" disabled={disabled} onClick={() => act('withdraw', rule({ card: null }))}>Withdraw</Button> : null}
        </Group>
      ) : null}

      {single ? (
        <Group gap={4} wrap="wrap" align="center" className="cf-card-part__timing">
          <Text size="xs" c="dimmed" w={52}>Timing</Text>
          <Text size="xs" className="cf-review__time">{timecode(span[0])}–{timecode(span[1])}</Text>
          <Button size="compact-xs" variant="light" disabled={disabled} onClick={() => at(0)}>Start here</Button>
          {STEPS.map((d) => <Button key={`s${d}`} size="compact-xs" variant="subtle" disabled={disabled} aria-label={`Start ${d > 0 ? '+' : ''}${d} s`} onClick={() => step(0, d)}>{d > 0 ? '+' : ''}{d}</Button>)}
          <Text size="xs" c="dimmed">·</Text>
          <Button size="compact-xs" variant="light" disabled={disabled} onClick={() => at(1)}>End here</Button>
          {STEPS.map((d) => <Button key={`e${d}`} size="compact-xs" variant="subtle" disabled={disabled} aria-label={`End ${d > 0 ? '+' : ''}${d} s`} onClick={() => step(1, d)}>{d > 0 ? '+' : ''}{d}</Button>)}
          <Button size="compact-xs" disabled={disabled || !changed} onClick={() => nudge({ in: span[0], out: span[1] })}>Save timing</Button>
          {row.handFixed ? <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={() => nudge(null)}>Drop hand fix</Button> : null}
        </Group>
      ) : null}

      {isWord ? (
        <div>
          <UnstyledButton onClick={() => setMore((v) => !v)} aria-expanded={more}><Text size="xs" c="dimmed">{more ? '▾' : '▸'} More for this word</Text></UnstyledButton>
          <Collapse in={more}>
            <Stack gap={6} pt={6}>
              <SegmentedControl size="xs" fullWidth data={WORD_CHOICES} value={wordRulings[String(row.label).toLowerCase()] || 'profile'} disabled={disabled} aria-label="This word in this film"
                onChange={(v) => act('word', [[`${base}/words/${encodeURIComponent(String(row.label).toLowerCase())}`, { value: v === 'profile' ? null : v }, 'PUT']])} />
              <Select size="xs" label={`All ${groupLabel(row.group).toLowerCase()} words in this film`} placeholder="Use settings" data={GROUP_CHOICES} disabled={disabled}
                onChange={(v) => v && act('group', [[`${base}/settings`, { settings: { language: { [row.group]: v } } }, 'PUT']])} />
            </Stack>
          </Collapse>
        </div>
      ) : null}

      <Group gap={6} wrap="wrap" className="cf-card-part__verdicts">
        <KeyButton k="A" color="green" variant={verdict === 'approve' ? 'filled' : 'light'} disabled={disabled} onClick={() => handlers.verdict?.('approve')}>Approve</KeyButton>
        <KeyButton k="X" color="gray" variant={verdict === 'remove' ? 'filled' : 'light'} disabled={disabled} onClick={() => handlers.verdict?.('remove')}>Let it play</KeyButton>
        <KeyButton k="D" color="orange" variant={verdict === 'redo' ? 'filled' : 'light'} disabled={disabled} onClick={() => handlers.verdict?.('redo')}>Redo</KeyButton>
        {canUndo ? <KeyButton k="U" variant="subtle" onClick={handlers.undo}>Undo</KeyButton> : null}
      </Group>
      <Text size="xs" c="dimmed" className="cf-card-part__hints">
        <Key k="Space" /> play/pause · <Key k="Enter" /> play with effect · <Key k="W" /> without · <Key k="←" /><Key k="→" /> parts · <Key k="?" /> all keys
      </Text>
      {busyText ? <Text size="xs" c="dimmed">{busyText}</Text> : null}
      {notice ? <Text size="sm" role="status">{notice}</Text> : null}
    </Stack>
  );
}

export default RowEditor;
