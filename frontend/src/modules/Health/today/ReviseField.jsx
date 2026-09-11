import { useState } from 'react';
import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { entryId, entryLabel, entryPins } from './entryCommands.js';

const logger = createAppLogger('health').child('revise');

/**
 * "It says rice; it was cauliflower rice."
 *
 * One field that re-derives the whole food from a correction — typed or spoken —
 * and REPLACES the row with it: new name, new icon, new mass, new estimates. The
 * alternative it exists to replace is retyping seven nutrients by hand to fix a
 * single wrong identity.
 *
 * It applies in one gesture rather than proposing and waiting for a second tap.
 * A preview would be the cautious design, and it is the wrong one here: the
 * correction is the person stating a fact about their own food, the change is one
 * versioned PUT, and saying it again re-derives from the correction rather than
 * from whatever the row currently holds — so a bad answer costs one more sentence,
 * not the original data. What is shown afterwards is what it HEARD and what it
 * did, which is where a mis-transcription becomes visible.
 *
 * PINS ARE SHOWN UP FRONT, not discovered afterwards. Fields corrected by hand
 * keep winning, but a pin you cannot see turns a correction into an unexplained
 * dead end — "I said cauliflower rice and the calories didn't move". They are
 * named beside the field, with one tap to release them before you speak.
 */
export function ReviseField({ row, onApply, busy: parentBusy = false }) {
  const [text, setText] = useState('');
  const [state, setState] = useState(null); // null | 'thinking' | 'applying'
  const [error, setError] = useState(null);
  const [released, setReleased] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const busy = parentBusy || state !== null;
  // Known from the row itself — no round trip needed to tell you what you pinned.
  const pins = entryPins(row);

  const revise = async (body) => {
    if (busy) return;
    setState('thinking'); setError(null); setOutcome(null);
    try {
      const result = await DaylightAPI(`api/v1/health/nutrilist/${entryId(row)}/revise`, body, 'POST');
      const skip = released ? [] : result.pinned;
      const changes = Object.fromEntries(Object.entries(result.proposal).filter(([field]) => !skip.includes(field)));
      logger.info('revise.interpreted', { uuid: entryId(row), basis: result.basis, pinned: result.pinned, released });
      if (!Object.keys(changes).length) {
        setError('Everything this would change is pinned. Release your edits to apply it.');
        return;
      }
      setState('applying');
      await onApply(changes, { correctedNutrients: Object.keys(changes).filter(field => field !== 'name' && field !== 'icon' && field !== 'color') });
      setText('');
      setOutcome({
        heard: result.instruction || body.instruction,
        name: result.proposal.name,
        grams: result.proposal.grams ?? null,
        basis: result.basis,
        volume: result.volume,
        skipped: skip,
      });
      logger.info('revise.applied', { uuid: entryId(row), fields: Object.keys(changes), released });
    } catch (err) {
      logger.warn('revise.failed', { uuid: entryId(row), error: err.message });
      setError(err.message || 'Could not work that out. Try saying it another way.');
    } finally { setState(null); }
  };

  return <Stack gap={4} className="health-revise">
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput className="health-revise__input" label="Say what this really was" placeholder="e.g. cauliflower rice"
        value={text} disabled={busy} onChange={event => setText(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Enter' && text.trim()) { event.preventDefault(); revise({ instruction: text.trim() }); } }} />
      <VoiceCapture active labelPrefix={`Say what ${entryLabel(row)} really was`} busy={busy}
        className="health-revise__mic" onCapture={dataUrl => revise({ audio: dataUrl })} />
      <Button size="compact-sm" disabled={busy || !text.trim()}
        loading={state !== null} onClick={() => revise({ instruction: text.trim() })}>Rework</Button>
    </Group>

    {pins.length ? <div className="health-revise__pins">
      <Text size="xs" c="dimmed">
        You set {pins.join(', ')} by hand, so {pins.length === 1 ? 'it stays put' : 'they stay put'}.
      </Text>
      <Button size="compact-xs" variant={released ? 'filled' : 'subtle'} disabled={busy}
        onClick={() => setReleased(value => !value)}>{released ? 'Keeping my edits' : 'Release all'}</Button>
    </div> : null}

    {outcome ? <Text size="xs" c="dimmed" role="status">
      {/* What it HEARD, first — a voice correction that mis-transcribes is
          otherwise indistinguishable from a model that misread a correct one. */}
      Heard “{outcome.heard}” → {outcome.name}
      {outcome.grams != null ? `, ${Math.round(outcome.grams)} g` : ''}
      {outcome.basis === 'weighed' ? ' (weighed, mass kept)'
        : outcome.volume ? ` (same ${outcome.volume.amount} ${outcome.volume.unit})` : ''}
      {outcome.skipped?.length ? ` · kept your ${outcome.skipped.join(', ')}` : ''}
    </Text> : null}

    {error ? <Text size="xs" role="alert" c="red">{error}</Text> : null}
  </Stack>;
}

export default ReviseField;
