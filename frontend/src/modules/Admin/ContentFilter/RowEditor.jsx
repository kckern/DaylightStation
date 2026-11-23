import { useEffect, useReducer, useRef, useState } from 'react';
import { ActionIcon, Button, Menu, Popover, SegmentedControl, Select, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowBackUp, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconEye, IconPlayerPlay, IconRestore } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { queueWrite } from './effectHolds.js';
import { effectChip, previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { fitEffectToChannel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { LANGUAGE_GROUPS } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { groupLabel, timecode } from './ReviewList.jsx';
import { isSceneRow, plays } from './reviewScope.js';
import { whyLine } from './whyLine.js';
import { TimingStrip } from './TimingStrip.jsx';
import { ChannelIcon, EffectIcon, effectFamily, timingState } from './partVisuals.jsx';
import { EffectMenu } from './EffectMenu.jsx';
import { CueBleepLevel, playTestBleep } from './BleepLevelPanel.jsx';
import { BLEEP_LEVEL_DEFAULT } from '../../../../../shared/contracts/content-filter/filterSettings.mjs';

/**
 * The part in hand, as one fixed-height panel (Fable design 2026-11-22, owner: "consolidate, make
 * better use of the space, the buttons should be more prominent"). Five lines, none of which grows:
 *   1. identity: the effect (a menu, E), the label, its channel, its timing, n/total and ‹ ›
 *   2. why it gets its effect, and Refine (R)
 *   3. the timing strip with every part in its window; a drag, a nudge or I / O saves itself
 *      (AUTOSAVE_MS after the last move), with Undo for the last saves and Reset to the measured timing
 *   4. play (Space), filtered (Enter), unfiltered (W) | Approve (A), Let it play (X), Redo (D), Undo (U)
 *   5. one status line for messages, the redo reasons and run notes
 * Every button carries its key. The full keymap is behind ? in the header.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
/** A trimmed span saves itself this long after the last move (owner, 2026-11-23: no Save step). */
export const AUTOSAVE_MS = 500;
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
const ROLE_VARIANT = { primary: 'filled', secondary: 'outline', tool: 'subtle' };
function KeyButton({ k, role, variant, icon = false, className = '', children, ...rest }) {
  return <Button size="sm" variant={variant ?? (role ? ROLE_VARIANT[role] : undefined)} className={`cf-card-part__btn ${role ? `is-${role}` : ''} ${rest.color === 'gray' ? 'is-gray' : ''} ${className}`} {...rest}><span className="cf-card__btn">{icon ? <IconCheck size={14} aria-hidden="true" /> : null}<span className="cf-card__btn-label">{children}</span> <Key k={k} /></span></Button>;
}

const membersOf = (r) => r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : []);
const singleOf = (r) => isSceneRow(r) || membersOf(r).length === 1;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

export function RowEditor({ ratingKey, row, onChanged = () => {}, busyText = null, wordRulings = {},
  position = null, handlers = {}, refineState = null, canUndo = false, status = null, stage = 'review',
  neighbours = [], ports = null, unfiltered = false, onPartMenu = null, filmLevel = null, maxHideSec = null }) {
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [span, setSpan] = useState([row.in, row.out]);
  const [drafts, setDrafts] = useState({});
  const [gripped, setGripped] = useState(false);
  // Undo steps per part: each autosave pushes what it replaced ({ row, prev, wasHandFixed }[]).
  const history = useRef({});
  const skipKey = useRef(null);
  // The drafts the last autosave wrote: saved, though the audit has not caught up with them yet.
  const [savedKey, setSavedKey] = useState(null);
  const [, bump] = useReducer((n) => n + 1, 0);
  const [cardText, setCardText] = useState(row.card?.text || '');
  const [menuOpen, setMenuOpen] = useState(false);
  // The popover under the effect button: the skip's card, or this word's rulings.
  const [panel, setPanel] = useState(null);
  useEffect(() => { setSpan([row.in, row.out]); setDrafts({}); setCardText(row.card?.text || ''); setNotice(null); }, [row.id, row.in, row.out, row.card?.text]);
  // A run locks what it rewrites (effects, timing, card); Approve and Redo stay open, except on a
  // part being refined (its verdict waits for the new timing).
  const disabled = Boolean(busyText) || Boolean(pending);
  // The effect stays changeable while a timing save is out: its write queues behind it (effectHolds.js).
  const fxDisabled = Boolean(busyText);
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
  // One bleeped cue can have its own bleep loudness, over the film's (and the household's).
  // A cue that holds a level stays adjustable (so it can be cleared) even if it is no longer a bleep.
  const savedCueLevel = typeof row.bleepLevel === 'number' ? row.bleepLevel : null;
  const bleepCue = !isScene && single && !playing && (row.effect === 'bleep' || savedCueLevel != null);
  const [cueLevel, setCueLevel] = useState(savedCueLevel);
  const cueLevelSaved = useRef(savedCueLevel);
  const levelChain = useRef(Promise.resolve());
  const levelWrites = useRef(0);
  useEffect(() => { if (!levelWrites.current) { setCueLevel(savedCueLevel); cueLevelSaved.current = savedCueLevel; } }, [row.id, savedCueLevel]);

  const act = async (key, calls, done) => {
    setPending(key); setNotice(null);
    try {
      await queueWrite(ratingKey, async () => { for (const [path, body, method] of calls) await DaylightAPI(path, body, method); });
      logger.info('review.action', { ratingKey, row: row.id, key });
      if (done) setNotice(done);
      onChanged();
      return true;
    } catch (err) {
      logger.warn('review.action_failed', { ratingKey, row: row.id, key, error: err.message });
      setNotice(err.message || 'That did not work.');
      return false;
    } finally { setPending(null); }
  };
  const ruleFor = (r, body) => (isSceneRow(r)
    ? [[`${base}/scenes/${encodeURIComponent(r.peekId)}`, body, 'PUT']]
    : membersOf(r).map((id) => [`${base}/cues/${encodeURIComponent(id)}`, body, 'PUT']));
  const rule = (body) => ruleFor(row, body);

  // Every click is a save, in order (a chain, so a slow PUT never lands after a later one); the
  // card shows the new level at once, and the film refreshes once the last save is in.
  const saveCueLevel = (value) => {
    if (!bleepCue) return;
    setCueLevel(value);
    const id = membersOf(row)[0];
    levelWrites.current += 1;
    levelChain.current = levelChain.current.then(async () => {
      try {
        await DaylightAPI(`${base}/cues/${encodeURIComponent(id)}`, { bleepLevel: value }, 'PUT');
        cueLevelSaved.current = value;
        logger.info('content_filter.review.cue_bleep_level', { rk: ratingKey, rowId: row.id, value });
      } catch (err) {
        logger.warn('content_filter.review.cue_bleep_level_failed', { rk: ratingKey, rowId: row.id, value, error: err.message });
        setCueLevel(cueLevelSaved.current);
        setNotice(err.message || 'The bleep level did not save.');
      } finally {
        levelWrites.current -= 1;
        if (!levelWrites.current) { onChanged(); previewStore.refresh().catch(() => false); }
      }
    });
  };

  // The parts the strip shows beside this one: filtered, one cue each (a hand fix is per cue).
  const near = neighbours.filter((r) => r.id !== row.id && !plays(r) && Number.isFinite(r.in) && Number.isFinite(r.out))
    .map((r) => ({ id: r.id, span: drafts[r.id] || [r.in, r.out], saved: [r.in, r.out], editable: singleOf(r) && !isSceneRow(r),
      family: effectFamily(r), label: r.label, row: r }));
  const changedOwn = !same(span, [row.in, row.out]);
  const changedOthers = near.filter((n) => drafts[n.id] && !same(drafts[n.id], n.saved));
  const changedCount = (changedOwn ? 1 : 0) + changedOthers.length;
  const autoKey = JSON.stringify([changedOwn ? span : null, changedOthers.map((n) => [n.id, drafts[n.id]])]);
  const saveTiming = async () => {
    if (!changedCount || disabled) return;
    const key = autoKey;
    const entries = [...(changedOwn ? [{ row, prev: [row.in, row.out], wasHandFixed: Boolean(row.handFixed) }] : []),
      ...changedOthers.map((n) => ({ row: n.row, prev: n.saved, wasHandFixed: Boolean(n.row.handFixed) }))];
    const calls = [...(changedOwn ? rule({ nudge: { in: span[0], out: span[1] } }) : []),
      ...changedOthers.flatMap((n) => ruleFor(n.row, { nudge: { in: drafts[n.id][0], out: drafts[n.id][1] } }))];
    skipKey.current = key; // a refused or slow-to-refresh save never re-fires on the same draft
    const ok = await act('nudge', calls, null);
    if (ok) {
      (history.current[row.id] ||= []).push(entries);
      setSavedKey(key);
      logger.info('content_filter.review.timing_autosaved', { rk: ratingKey, rowId: row.id, parts: entries.length });
      // The player reads its filter once: refresh it, so the saved timing plays once the drafts clear.
      previewStore.refresh().catch(() => false);
    }
  };
  // Undo the last autosave of this part: back to what it replaced, or to the measured timing when
  // the part had no hand fix before.
  const undoTiming = async () => {
    const stack = history.current[row.id];
    if (!stack?.length || disabled || unsaved) return;
    const entries = stack[stack.length - 1];
    const calls = entries.flatMap((e) => ruleFor(e.row, { nudge: e.wasHandFixed ? { in: e.prev[0], out: e.prev[1] } : null }));
    const ok = await act('nudge', calls, null);
    if (ok) { stack.pop(); bump(); previewStore.refresh().catch(() => false); }
  };
  useEffect(() => { if (!changedCount) skipKey.current = null; }, [changedCount]);
  useEffect(() => {
    if (!changedCount || disabled || gripped || skipKey.current === autoKey) return undefined;
    const timer = setTimeout(saveTiming, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [autoKey, changedCount, disabled, gripped]); // eslint-disable-line react-hooks/exhaustive-deps
  // I / O: an edge of the part in hand at the playhead, as a draft (owner, 2026-11-22).
  const mark = (edge) => {
    if (disabled || !single || playing) return;
    const t = previewStore.currentTime();
    if (t == null) { setNotice('Play the film first.'); return; }
    const v = Math.round(t * 1000) / 1000;
    if (edge === 0 && v >= span[1] - 0.05) { setNotice("The playhead is after this part's end: set the out point first (O)."); return; }
    if (edge === 1 && v <= span[0] + 0.05) { setNotice("The playhead is before this part's start: set the in point first (I)."); return; }
    setNotice(null);
    setSpan(edge === 0 ? [v, span[1]] : [span[0], v]);
  };
  const resetDrafts = () => { setSpan([row.in, row.out]); setDrafts({}); setNotice(null); };
  // Drafts play before they are saved (owner, 2026-11-22: "drag, confirm, then save when I'm
  // satisfied"): every unsaved span in the strip goes to the preview store, which the player applies.
  const draftMap = {};
  if (changedOwn && single && !isScene) draftMap[membersOf(row)[0]] = span;
  for (const n of changedOthers) if (!isSceneRow(n.row)) draftMap[membersOf(n.row)[0]] = drafts[n.id];
  const draftKey = JSON.stringify(draftMap);
  useEffect(() => { previewStore.setDrafts(JSON.parse(draftKey)); }, [draftKey]);
  useEffect(() => () => previewStore.setDrafts(null), []);
  // The station holds the cursor while a dragged span is unsaved (it was silently dropped by a step:
  // review 2026-11-22); Esc there drops every draft through this.
  const dirtyPort = handlers.timingDirty;
  // A draft the autosave already wrote no longer holds the cursor: the list shows the old span until
  // the re-audit lands (seconds), and holding the cursor that long refused every move (review
  // 2026-11-23: 21 moves refused in a minute, then a page reload).
  const unsaved = Boolean(changedCount) && autoKey !== savedKey;
  useEffect(() => {
    dirtyPort?.(unsaved ? resetDrafts : null);
  }, [unsaved, row.in, row.out]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => dirtyPort?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  // E opens the effect menu and S saves the timing (ReviewPage wires the keys to these).
  useEffect(() => {
    if (!ports) return undefined;
    ports.current = { openEffect: () => { if (!fxDisabled) setMenuOpen(true); }, markIn: () => mark(0), markOut: () => mark(1),
      openBleepLevel: () => { if (!disabled && bleepCue) setPanel('bleep'); } };
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
  const levelItem = bleepCue ? <Menu.Item onClick={() => setPanel('bleep')}>Bleep volume for this cue…</Menu.Item> : null;
  const word = String(row.label).toLowerCase();
  const filmShown = filmLevel ?? BLEEP_LEVEL_DEFAULT;

  return (
    // A click must not leave a button focused: Enter would press it again (Enter plays the part).
    <div className="cf-card-part" aria-label="Part under review" data-family={family || 'plays'}
      onMouseDown={(e) => { if (e.target.closest?.('button, [role="slider"]')) e.preventDefault(); }}>
      <div className="cf-card-part__identity">
        <Popover opened={Boolean(panel)} onChange={(o) => { if (!o) setPanel(null); }} position="bottom-start" withinPortal width={360} shadow="md" trapFocus>
          <Popover.Target>
            <span>
              <EffectMenu row={row} maxHideSec={maxHideSec} opened={menuOpen} onChange={setMenuOpen} disabled={fxDisabled}
                onPick={(letter) => handlers.effect?.(letter)}
                target={(
                  <UnstyledButton className={`cf-card-part__fx is-${family || 'plays'}`} aria-label={`Effect: ${fx}. Change it (E)`} disabled={fxDisabled}>
                    <EffectIcon row={row} size={18} />
                    <span>{fx}</span>
                    <IconChevronDown size={14} aria-hidden="true" />
                    <Key k="E" />
                  </UnstyledButton>
                )}>
                <Menu.Divider />
                {settingsItem}
                {levelItem}
                {wordItem}
                {cardItem}
              </EffectMenu>
            </span>
          </Popover.Target>
          <Popover.Dropdown>
            {panel === 'bleep' ? (
              <div className="cf-card-part__panel">
                <CueBleepLevel value={cueLevel} film={filmShown} onSet={saveCueLevel} onTest={(l) => playTestBleep(l)} />
              </div>
            ) : panel === 'word' ? (
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
              <span className={`cf-ico cf-ico--timing is-${timing.unsure ? 'unsure' : timing.key}`} aria-hidden="true"><timing.Icon size={13} stroke={1.8} aria-hidden="true" /></span>
              <span className="cf-card-part__chiptext">{timing.word.startsWith('Timing unsure') ? 'Timing unsure' : timing.word}</span></span> : null}
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
          <KeyButton k="R" role="tool" size="compact-sm" variant={why.refine && row.timing === 'rough' && !why.tried ? 'light' : undefined} color={why.tried ? 'gray' : undefined} disabled={Boolean(pending)} onClick={handlers.refine}>
            {row.timing === 'rough' && !why.tried ? 'Refine' : 'Refine again'}
          </KeyButton>
        ) : null}
      </div>

      <div className="cf-card-part__timing">
        {showStrip ? (
          <TimingStrip span={span} saved={[row.in, row.out]} onChange={setSpan} onNotice={setNotice} disabled={disabled} onDragging={setGripped}
            neighbours={near} onNeighbourChange={(id, next) => setDrafts((d) => ({ ...d, [id]: next }))}
            row={row} onPartMenu={onPartMenu} applying={pending === 'nudge'} />
        ) : (
          <Text size="xs" c="dimmed" className="cf-card-part__nostrip">
            {playing ? 'This part plays as it is.' : `${timecode(row.in)}–${timecode(row.out)}: several parts together; open one to fit its timing.`}
          </Text>
        )}
        <div className="cf-card-part__save">
          {unsaved || pending === 'nudge' ? (
            <Text size="xs" c="dimmed" role="status" className="cf-card-part__autosave">{pending === 'nudge' ? 'Saving…' : 'Saving timing…'}</Text>
          ) : (
            <>
              {history.current[row.id]?.length ? (
                <ActionIcon variant="subtle" color="gray" size="md" disabled={disabled} aria-label="Undo the last timing change" title="Undo the last timing change"
                  onClick={undoTiming}><IconArrowBackUp size={16} aria-hidden="true" /></ActionIcon>
              ) : null}
              {row.handFixed ? (
                <ActionIcon variant="subtle" color="gray" size="md" disabled={disabled} aria-label="Drop the hand fix" title="Drop the hand fix (back to the measured timing)"
                  onClick={() => act('nudge', rule({ nudge: null }), 'Hand fix dropped.')}><IconRestore size={16} aria-hidden="true" /></ActionIcon>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="cf-card-part__actions">
        <div className="cf-card-part__play">
          <KeyButton k="Space" role="secondary" color="gray" className="is-icon" onClick={handlers.togglePlay} aria-label="Play or pause the film" title="Play or pause the film (Space)"><IconPlayerPlay size={16} aria-hidden="true" /></KeyButton>
          <KeyButton k="↵" role="secondary" color="gray" onClick={handlers.replay} title="Play this part with its effect, from 4 s before">Filtered</KeyButton>
          <KeyButton k="W" role="secondary" color={unfiltered ? 'orange' : 'gray'} aria-pressed={unfiltered}
            onClick={handlers.playWithout} title="Play this part with the effect off, to judge it"><IconEye size={16} aria-hidden="true" />Unfiltered</KeyButton>
        </div>
        {playing ? null : stage === 'refine' ? null : (
          <div className="cf-card-part__verdicts">
            <KeyButton k="A" role={changedCount || verdict ? 'secondary' : 'primary'} color="green" className={`is-approve${verdict === 'approve' ? ' is-chosen' : ''}`} icon={verdict === 'approve'} aria-pressed={verdict === 'approve'} disabled={verdictLocked} onClick={() => handlers.verdict?.('approve')}>Approve</KeyButton>
            <KeyButton k="X" role="secondary" color="gray" className={verdict === 'remove' ? 'is-chosen' : ''} icon={verdict === 'remove'} aria-pressed={verdict === 'remove'} disabled={verdictLocked || Boolean(busyText)}
              title={busyText ? 'Let it play waits until the refine finishes' : undefined} onClick={() => handlers.verdict?.('remove')}>Let it play</KeyButton>
            <KeyButton k="D" role="secondary" color="orange" className={verdict === 'redo' ? 'is-chosen' : ''} icon={verdict === 'redo'} aria-pressed={verdict === 'redo'} disabled={verdictLocked} onClick={() => (handlers.redo ? handlers.redo() : handlers.verdict?.('redo'))}>Redo</KeyButton>
            {canUndo ? <KeyButton k="U" role="tool" className="is-icon" aria-label="Undo the last verdict" title="Undo the last verdict (U)" disabled={Boolean(busyText)} onClick={handlers.undo}><IconArrowBackUp size={16} aria-hidden="true" /></KeyButton> : null}
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
