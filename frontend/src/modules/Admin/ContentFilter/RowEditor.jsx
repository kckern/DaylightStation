import { useEffect, useState } from 'react';
import { Button, Menu, Popover, SegmentedControl, Select, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowBackUp, IconChevronDown, IconChevronLeft, IconChevronRight, IconEye, IconPlayerPlay } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { fitEffectToChannel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { LANGUAGE_GROUPS } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { groupLabel, timecode } from './ReviewList.jsx';
import { isSceneRow, plays } from './reviewScope.js';
import { whyLine } from './whyLine.js';
import { TimingStrip } from './TimingStrip.jsx';
import { ChannelIcon, EffectIcon, effectFamily, timingState } from './partVisuals.jsx';
import { EffectMenu } from './EffectMenu.jsx';

/**
 * The part in hand, as one fixed-height panel (Fable design 2026-11-22, owner: "consolidate, make
 * better use of the space, the buttons should be more prominent"). Five lines, none of which grows:
 *   1. identity: the effect (a menu, E), the label, its channel, its timing, n/total and ‹ ›
 *   2. why it gets its effect, and Refine (R)
 *   3. the timing strip with every part in its window, Save timing (S) and Reset
 *   4. play (Space), filtered (Enter), unfiltered (W) | Approve (A), Let it play (X), Redo (D), Undo (U)
 *   5. one status line for messages, the redo reasons and run notes
 * Every button carries its key. The full keymap is behind ? in the header.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const CUE_EFFECTS = [['mute', 'Mute'], ['bleep', 'Bleep'], ['blur', 'Blur'], ['full-blur', 'Full blur'], ['blackout', 'Hide picture'], ['skip', 'Skip']];
const WORD_CHOICES = [{ value: 'profile', label: 'Settings' }, { value: 'off', label: 'Play' }, { value: 'mute', label: 'Mute' }, { value: 'bleep', label: 'Bleep' }];
const GROUP_CHOICES = [{ value: 'off', label: 'Play them' }, { value: 'mute', label: 'Mute them' }, { value: 'bleep', label: 'Bleep them' }];

/** R1: the cue effects that fit this channel as they are (tracked or not). */
export function effectChoices(modality) {
  const fits = (e) => fitEffectToChannel(e, modality, { hasRegions: true }) === e || fitEffectToChannel(e, modality, { hasRegions: false }) === e;
  return [{ label: 'Use settings', value: 'profile' }, { label: 'Off', value: 'off' },
    ...CUE_EFFECTS.filter(([e]) => fits(e)).map(([value, label]) => ({ label, value }))];
}

const Key = ({ k }) => <kbd className="cf-keybar__key">{k}</kbd>;

/** A button that shows its key. */
function KeyButton({ k, children, className = '', ...rest }) {
  return <Button size="sm" className={`cf-card-part__btn ${className}`} {...rest}><span className="cf-card__btn">{children} <Key k={k} /></span></Button>;
}

const membersOf = (r) => r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : []);
const singleOf = (r) => isSceneRow(r) || membersOf(r).length === 1;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

export function RowEditor({ ratingKey, row, onChanged = () => {}, busyText = null, wordRulings = {},
  position = null, handlers = {}, refineState = null, canUndo = false, status = null, stage = 'review',
  neighbours = [], ports = null, unfiltered = false }) {
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [span, setSpan] = useState([row.in, row.out]);
  const [drafts, setDrafts] = useState({});
  const [cardText, setCardText] = useState(row.card?.text || '');
  const [menuOpen, setMenuOpen] = useState(false);
  // The popover under the effect button: the skip's card, or this word's rulings.
  const [panel, setPanel] = useState(null);
  useEffect(() => { setSpan([row.in, row.out]); setDrafts({}); setCardText(row.card?.text || ''); setNotice(null); }, [row.id, row.in, row.out, row.card?.text]);
  // A run locks what it rewrites (effects, timing, card); Approve and Redo stay open, except on a
  // part being refined (its verdict waits for the new timing).
  const disabled = Boolean(busyText) || Boolean(pending);
  const verdictLocked = Boolean(pending) || Boolean(refineState?.state);
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const isScene = isSceneRow(row);
  const single = singleOf(row);
  const isWord = row.modality === 'said' && LANGUAGE_GROUPS.includes(row.group);
  const why = whyLine(row);
  const playing = plays(row);
  const timing = timingState(row);
  const refining = refineState?.state;
  const verdict = row.verdict?.verdict;
  const wantsCard = row.effect === 'skip-card' || (isScene && row.card);

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
  const ruleFor = (r, body) => (isSceneRow(r)
    ? [[`${base}/scenes/${encodeURIComponent(r.peekId)}`, body, 'PUT']]
    : membersOf(r).map((id) => [`${base}/cues/${encodeURIComponent(id)}`, body, 'PUT']));
  const rule = (body) => ruleFor(row, body);

  // The parts the strip shows beside this one: filtered, one cue each (a hand fix is per cue).
  const near = neighbours.filter((r) => r.id !== row.id && !plays(r) && Number.isFinite(r.in) && Number.isFinite(r.out))
    .map((r) => ({ id: r.id, span: drafts[r.id] || [r.in, r.out], saved: [r.in, r.out], editable: singleOf(r) && !isSceneRow(r),
      family: effectFamily(r), label: r.label, row: r }));
  const changedOwn = !same(span, [row.in, row.out]);
  const changedOthers = near.filter((n) => drafts[n.id] && !same(drafts[n.id], n.saved));
  const changedCount = (changedOwn ? 1 : 0) + changedOthers.length;
  const saveTiming = () => {
    if (!changedCount || disabled) return;
    const calls = [...(changedOwn ? rule({ nudge: { in: span[0], out: span[1] } }) : []),
      ...changedOthers.flatMap((n) => ruleFor(n.row, { nudge: { in: drafts[n.id][0], out: drafts[n.id][1] } }))];
    act('nudge', calls, changedCount > 1 ? `${changedCount} timings saved.` : 'Timing saved.');
  };
  const resetDrafts = () => { setSpan([row.in, row.out]); setDrafts({}); setNotice(null); };
  // The station holds the cursor while a dragged span is unsaved (it was silently dropped by a step:
  // review 2026-11-22); Esc there drops every draft through this.
  const dirtyPort = handlers.timingDirty;
  useEffect(() => {
    dirtyPort?.(changedCount ? resetDrafts : null);
  }, [changedCount, row.in, row.out]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => dirtyPort?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  // E opens the effect menu and S saves the timing (ReviewPage wires the keys to these).
  useEffect(() => {
    if (!ports) return undefined;
    ports.current = { openEffect: () => { if (!disabled) setMenuOpen(true); }, saveTiming };
    return () => { ports.current = {}; };
  });

  const showStrip = single && !playing;
  const fx = playing ? (row.why === 'removed' ? 'Plays (removed)' : 'Plays') : effectChip(row.effect);
  const family = effectFamily(row);
  const settingsItem = (
    <Menu.Item onClick={() => act('effect', rule({ effect: 'profile', disabled: false }))}>Use household settings</Menu.Item>
  );
  const wordItem = isWord ? <Menu.Item onClick={() => setPanel('word')}>More for this word…</Menu.Item> : null;
  const cardItem = wantsCard || row.effect === 'skip' ? (
    <Menu.Item onClick={() => setPanel('card')}>{row.card ? 'Card shown in place of the skip…' : 'Add a card in place of the skip…'}</Menu.Item>
  ) : null;
  const word = String(row.label).toLowerCase();

  return (
    // A click must not leave a button focused: Enter would press it again (Enter plays the part).
    <div className="cf-card-part" aria-label="Part under review" data-family={family || 'plays'}
      onMouseDown={(e) => { if (e.target.closest?.('button, [role="slider"]')) e.preventDefault(); }}>
      <div className="cf-card-part__identity">
        <Popover opened={Boolean(panel)} onChange={(o) => { if (!o) setPanel(null); }} position="bottom-start" withinPortal width={360} shadow="md" trapFocus>
          <Popover.Target>
            <span>
              <EffectMenu row={row} opened={menuOpen} onChange={setMenuOpen} disabled={disabled}
                onPick={(letter) => handlers.effect?.(letter)}
                target={(
                  <UnstyledButton className={`cf-card-part__fx is-${family || 'plays'}`} aria-label={`Effect: ${fx}. Change it (E)`} disabled={disabled}>
                    <EffectIcon row={row} size={18} />
                    <span>{fx}</span>
                    <IconChevronDown size={14} aria-hidden="true" />
                    <Key k="E" />
                  </UnstyledButton>
                )}>
                <Menu.Divider />
                {settingsItem}
                {wordItem}
                {cardItem}
              </EffectMenu>
            </span>
          </Popover.Target>
          <Popover.Dropdown>
            {panel === 'word' ? (
              <div className="cf-card-part__panel">
                <Text size="xs" c="dimmed">{`"${word}" in this film`}</Text>
                <SegmentedControl size="xs" fullWidth data={WORD_CHOICES} value={wordRulings[word] || 'profile'} disabled={disabled} aria-label="This word in this film"
                  onChange={(v) => act('word', [[`${base}/words/${encodeURIComponent(word)}`, { value: v === 'profile' ? null : v }, 'PUT']])} />
                <Select size="xs" label={`All ${groupLabel(row.group).toLowerCase()} in this film`} placeholder="Use settings" data={GROUP_CHOICES} disabled={disabled} comboboxProps={{ withinPortal: false }}
                  onChange={(v) => v && act('group', [[`${base}/settings`, { settings: { language: { [row.group]: v } } }, 'PUT']])} />
              </div>
            ) : (
              <div className="cf-card-part__panel">
                <TextInput size="xs" data-autofocus label={row.card?.approved ? 'Card (approved)' : 'Card shown in place of the skip'} maxLength={90}
                  value={cardText} onChange={(e) => setCardText(e.currentTarget.value)} disabled={disabled} />
                <div className="cf-card-part__cardbtns">
                  <Button size="compact-xs" disabled={disabled || !cardText.trim()} onClick={() => act('card', rule({ card: { approve: true, text: cardText.trim() } }), 'Card approved.')}>Approve card</Button>
                  <Button size="compact-xs" variant="subtle" disabled={disabled || !single}
                    onClick={() => act('draft', [[isScene ? `${base}/scenes/${encodeURIComponent(row.peekId)}/card` : `${base}/cues/${encodeURIComponent(membersOf(row)[0])}/card`, {}, 'POST']], 'Card drafted.')}>Draft</Button>
                  {row.card?.approved ? <Button size="compact-xs" variant="subtle" color="red" disabled={disabled} onClick={() => act('withdraw', rule({ card: null }))}>Withdraw</Button> : null}
                </div>
              </div>
            )}
          </Popover.Dropdown>
        </Popover>
        <Text className="cf-card-part__title" title={`${row.label} · ${timecode(row.in)}–${timecode(row.out)}`}>{row.label}</Text>
        <span className="cf-card-part__facts" title={[row.group && groupLabel(row.group), row.modality, row.handFixed ? 'hand-fixed' : null].filter(Boolean).join(' · ')}>
          <ChannelIcon row={row} size={16} />
          {refining ? <span className="cf-card-part__chip is-refining">{refining}</span>
            : timing ? <span className={`cf-card-part__chip is-${timing.key}${timing.unsure ? ' is-unsure' : ''}`} data-timing={timing.key}
              title={timing.unsure ? 'Timing unsure: listen before approving' : timing.word}>
              <timing.Icon size={13} stroke={1.8} aria-hidden="true" />{timing.word.startsWith('Timing unsure') ? 'Timing unsure' : timing.word}</span> : null}
        </span>
        <span className="cf-card-part__where" aria-label={position ? `Part ${position.index + 1} of ${position.total}` : 'Not in this list'}>
          {position ? `${position.index + 1}/${position.total}` : '–'}
        </span>
        <UnstyledButton className="cf-card-part__step" onClick={handlers.prev} disabled={!position || position.index <= 0} aria-label="Previous part" title="Previous part (←)"><IconChevronLeft size={18} /></UnstyledButton>
        <UnstyledButton className="cf-card-part__step" onClick={handlers.next} disabled={Boolean(position) && position.index >= position.total - 1} aria-label="Next part" title="Next part (→)"><IconChevronRight size={18} /></UnstyledButton>
      </div>

      <div className="cf-card-part__why">
        <Text size="sm" className="cf-card-part__whytext" title={why.text}>{why.text}</Text>
        {!isScene && !playing && !refining ? (
          // Filled only where refine is the next step; a part it already tried gets a quiet "Refine again".
          <KeyButton k="R" size="compact-sm" variant={why.refine && row.timing === 'rough' ? 'filled' : 'light'} color={why.tried ? 'gray' : undefined} disabled={Boolean(pending)} onClick={handlers.refine}>
            {row.timing === 'rough' && !why.tried ? 'Refine' : 'Refine again'}
          </KeyButton>
        ) : null}
      </div>

      <div className="cf-card-part__timing">
        {showStrip ? (
          <TimingStrip span={span} saved={[row.in, row.out]} onChange={setSpan} onNotice={setNotice} disabled={disabled}
            neighbours={near} onNeighbourChange={(id, next) => setDrafts((d) => ({ ...d, [id]: next }))} />
        ) : (
          <Text size="xs" c="dimmed" className="cf-card-part__nostrip">
            {playing ? 'This part plays as it is.' : `${timecode(row.in)}–${timecode(row.out)}: several parts together; open one to fit its timing.`}
          </Text>
        )}
        <div className="cf-card-part__save">
          <KeyButton k="S" size="compact-sm" variant={changedCount ? 'filled' : 'default'} disabled={disabled || !changedCount || !showStrip} onClick={saveTiming}>
            {changedCount > 1 ? `Save ${changedCount} timings` : 'Save timing'}
          </KeyButton>
          {changedCount ? <Button size="compact-xs" variant="subtle" onClick={resetDrafts}>Undo drag</Button>
            : row.handFixed ? <Button size="compact-xs" variant="subtle" disabled={disabled} title="Drop the hand fix: back to the measured timing"
              onClick={() => act('nudge', rule({ nudge: null }), 'Hand fix dropped.')}>Reset</Button> : null}
        </div>
      </div>

      <div className="cf-card-part__actions">
        <div className="cf-card-part__play">
          <KeyButton k="Space" variant="default" className="is-icon" onClick={handlers.togglePlay} aria-label="Play or pause the film" title="Play or pause the film (Space)"><IconPlayerPlay size={16} aria-hidden="true" /></KeyButton>
          <KeyButton k="↵" variant="default" onClick={handlers.replay} title="Play this part with its effect, from 4 s before">Filtered</KeyButton>
          <KeyButton k="W" variant={unfiltered ? 'filled' : 'default'} color={unfiltered ? 'orange' : undefined} aria-pressed={unfiltered}
            onClick={handlers.playWithout} title="Play this part with the effect off, to judge it"><IconEye size={16} aria-hidden="true" />Unfiltered</KeyButton>
        </div>
        {playing ? null : stage === 'refine' ? null : (
          <div className="cf-card-part__verdicts">
            <KeyButton k="A" color="green" className="is-approve" variant={verdict === 'approve' ? 'filled' : 'light'} aria-pressed={verdict === 'approve'} disabled={verdictLocked} onClick={() => handlers.verdict?.('approve')}>Approve</KeyButton>
            <KeyButton k="X" color="gray" variant={verdict === 'remove' ? 'filled' : 'light'} aria-pressed={verdict === 'remove'} disabled={verdictLocked || Boolean(busyText)}
              title={busyText ? 'Let it play waits until the refine finishes' : undefined} onClick={() => handlers.verdict?.('remove')}>Let it play</KeyButton>
            <KeyButton k="D" color="orange" variant={verdict === 'redo' ? 'filled' : 'light'} aria-pressed={verdict === 'redo'} disabled={verdictLocked} onClick={() => (handlers.redo ? handlers.redo() : handlers.verdict?.('redo'))}>Redo</KeyButton>
            {canUndo ? <KeyButton k="U" variant="subtle" className="is-icon" aria-label="Undo the last verdict" title="Undo the last verdict (U)" disabled={Boolean(busyText)} onClick={handlers.undo}><IconArrowBackUp size={16} aria-hidden="true" /></KeyButton> : null}
          </div>
        )}
      </div>

      <div className="cf-card-part__status">
        {status}
        {notice ? <Text size="sm" role="status">{notice}</Text> : null}
        {!notice && refining ? <Text size="xs" c="dimmed">Verdict when the new timing lands.</Text> : null}
        {!notice && !refining && stage === 'refine' && !playing ? <Text size="xs" c="dimmed">Verdicts are given on the Review tab: a verdict resets when its part is refined.</Text> : null}
        {busyText ? <Text size="xs" c="dimmed">{busyText}</Text> : null}
      </div>
    </div>
  );
}

export default RowEditor;
