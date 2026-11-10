import { useEffect, useState } from 'react';
import { Button, Group, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { fitEffectToChannel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { LANGUAGE_GROUPS } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { groupLabel, timecode } from './ReviewList.jsx';

/**
 * The selected part's tools: its effect (R1: only what fits its channel), this film's ruling for a
 * word, its card, a hand nudge of its timing, send it back to the pipeline, and mark it reviewed.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const CUE_EFFECTS = [['mute', 'Mute'], ['bleep', 'Bleep'], ['blur', 'Blur'], ['full-blur', 'Full blur'], ['skip', 'Skip']];
const SCENE_EFFECTS = [{ label: 'Use settings', value: 'profile' }, { label: 'Play it', value: 'off' }, { label: 'Hide picture', value: 'blackout' }, { label: 'Skip', value: 'skip' }];
const WORD_CHOICES = [{ label: 'Use settings', value: 'profile' }, { label: 'Play this word', value: 'off' }, { label: 'Mute this word', value: 'mute' }, { label: 'Bleep this word', value: 'bleep' }];
const GROUP_CHOICES = [{ label: 'Play', value: 'off' }, { label: 'Mute', value: 'mute' }, { label: 'Bleep', value: 'bleep' }];
const STEPS = [-0.5, -0.1, 0.1, 0.5];

/** R1: the cue effects that fit this channel as they are (tracked or not). */
export function effectChoices(modality) {
  const fits = (e) => fitEffectToChannel(e, modality, { hasRegions: true }) === e || fitEffectToChannel(e, modality, { hasRegions: false }) === e;
  return [{ label: 'Use settings', value: 'profile' }, { label: 'Off', value: 'off' },
    ...CUE_EFFECTS.filter(([e]) => fits(e)).map(([value, label]) => ({ label, value }))];
}

export function RowEditor({ ratingKey, row, onChanged = () => {}, busyText = null, auditFresh = true, wordRulings = {} }) {
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [span, setSpan] = useState([row.in, row.out]);
  const [cardText, setCardText] = useState(row.card?.text || '');
  useEffect(() => { setSpan([row.in, row.out]); setCardText(row.card?.text || ''); setNotice(null); }, [row.id, row.in, row.out, row.card?.text]);
  const disabled = Boolean(busyText) || Boolean(pending);
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const isScene = row.kind === 'scenes';
  // An audit stored before rows carried `members`: a cue row is its own member.
  const members = row.members ?? (String(row.id).startsWith('cue:') ? [row.peekId] : []);
  const single = isScene || members.length === 1;
  const isWord = row.modality === 'said' && LANGUAGE_GROUPS.includes(row.group);

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
  const setEffect = (v) => act('effect', rule(v === 'profile' ? { effect: 'profile', disabled: false } : { effect: v }));
  const nudge = (value) => act('nudge', rule({ nudge: value }), value ? 'Timing saved.' : 'Hand fix dropped.');
  const at = (edge) => {
    const t = previewStore.currentTime();
    if (t == null) { setNotice('Play the film first.'); return; }
    setSpan((s) => (edge === 0 ? [t, s[1]] : [s[0], t]));
  };
  const step = (edge, d) => setSpan((s) => s.map((v, i) => (i === edge ? Math.round((v + d) * 1000) / 1000 : v)));
  const changed = span[0] !== row.in || span[1] !== row.out;
  const effects = isScene ? SCENE_EFFECTS : effectChoices(row.modality);
  const current = effects.some((o) => o.value === row.effect) ? row.effect : 'profile';

  return (
    <Stack gap="xs" className="cf-editor">
      <Group justify="space-between" wrap="wrap">
        <Text fw={600}>{row.label}</Text>
        {busyText ? <Text size="sm" c="dimmed">{busyText}</Text> : null}
      </Group>
      <SegmentedControl size="xs" fullWidth data={effects} value={current} disabled={disabled} onChange={setEffect} aria-label="Effect" />
      {isWord ? (
        <>
          <SegmentedControl size="xs" fullWidth data={WORD_CHOICES} value={wordRulings[String(row.label).toLowerCase()] || 'profile'} disabled={disabled} aria-label="This word in this film"
            onChange={(v) => act('word', [[`${base}/words/${encodeURIComponent(String(row.label).toLowerCase())}`, { value: v === 'profile' ? null : v }, 'PUT']])} />
          <Select size="xs" label={`All ${groupLabel(row.group).toLowerCase()} words in this film`} placeholder="Use settings" data={GROUP_CHOICES} disabled={disabled}
            onChange={(v) => v && act('group', [[`${base}/settings`, { settings: { language: { [row.group]: v } } }, 'PUT']])} />
        </>
      ) : null}
      {row.effect === 'skip-card' || (isScene && row.card) ? (
        <Group gap="xs" wrap="wrap" align="flex-end">
          <TextInput size="xs" className="cf-editor__card" label={row.card?.approved ? 'Card (approved)' : 'Card'} maxLength={90}
            value={cardText} onChange={(e) => setCardText(e.currentTarget.value)} disabled={disabled} />
          <Button size="compact-xs" disabled={disabled || !cardText.trim()} onClick={() => act('card', rule({ card: { approve: true, text: cardText.trim() } }), 'Card approved.')}>Approve card</Button>
          <Button size="compact-xs" variant="subtle" disabled={disabled || !single}
            onClick={() => act('draft', [[isScene ? `${base}/scenes/${encodeURIComponent(row.peekId)}/card` : `${base}/cues/${encodeURIComponent(members[0])}/card`, {}, 'POST']], 'Card drafted.')}>Draft</Button>
          {row.card?.approved ? <Button size="compact-xs" variant="subtle" color="red" disabled={disabled} onClick={() => act('withdraw', rule({ card: null }))}>Withdraw</Button> : null}
        </Group>
      ) : null}
      {single ? (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">Timing {timecode(span[0])}–{timecode(span[1])}{row.handFixed ? ' (hand-fixed)' : ''}</Text>
          <Group gap={4} wrap="wrap">
            <Button size="compact-xs" variant="light" disabled={disabled} onClick={() => at(0)}>Set start here</Button>
            {STEPS.map((d) => <Button key={`s${d}`} size="compact-xs" variant="subtle" disabled={disabled} aria-label={`Start ${d > 0 ? '+' : ''}${d} s`} onClick={() => step(0, d)}>{d > 0 ? '+' : ''}{d}</Button>)}
          </Group>
          <Group gap={4} wrap="wrap">
            <Button size="compact-xs" variant="light" disabled={disabled} onClick={() => at(1)}>Set end here</Button>
            {STEPS.map((d) => <Button key={`e${d}`} size="compact-xs" variant="subtle" disabled={disabled} aria-label={`End ${d > 0 ? '+' : ''}${d} s`} onClick={() => step(1, d)}>{d > 0 ? '+' : ''}{d}</Button>)}
          </Group>
          <Group gap="xs">
            <Button size="compact-xs" disabled={disabled || !changed} onClick={() => nudge({ in: span[0], out: span[1] })}>Save timing</Button>
            {row.handFixed ? <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={() => nudge(null)}>Drop hand fix</Button> : null}
          </Group>
        </Stack>
      ) : null}
      <Group gap="xs" wrap="wrap">
        {row.reviewed
          ? <Button size="compact-xs" variant="light" disabled={disabled} onClick={() => act('unmark', [[`${base}/review/${encodeURIComponent(row.id)}`, {}, 'DELETE']])}>Unmark</Button>
          : <Button size="compact-xs" disabled={disabled || !auditFresh} onClick={() => act('mark', [[`${base}/review/${encodeURIComponent(row.id)}`, { span: [row.in, row.out] }, 'PUT']])}>Mark reviewed</Button>}
        {!isScene && members.length ? (
          <Button size="compact-xs" variant="subtle" disabled={disabled} title="Sends this back to the pipeline; your hand fix on it is dropped."
            onClick={() => act('send-back', [[`${base}/jobs`, { kind: 'send-back', cues: members }, 'POST']], 'Sent back to the pipeline.')}>Send back</Button>
        ) : null}
      </Group>
      {!row.reviewed && !auditFresh ? <Text size="xs" c="dimmed">Mark reviewed once the audit is current.</Text> : null}
      {!isScene ? <Text size="xs" c="dimmed">Send back: the pipeline measures this again; your hand fix on it is dropped.</Text> : null}
      {notice ? <Text size="sm" role="status">{notice}</Text> : null}
    </Stack>
  );
}

export default RowEditor;
