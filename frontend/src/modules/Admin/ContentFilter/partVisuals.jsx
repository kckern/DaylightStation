import {
  IconAlertTriangle, IconBlur, IconBracketsContain, IconCircle, IconCircleCheck, IconCircleDashed, IconClock, IconEar, IconEye, IconEyeOff,
  IconLoader2, IconMessage, IconMinus, IconPlayerPlay, IconPlayerSkipForward, IconRefresh, IconTarget, IconVolumeOff, IconWaveSine,
} from '@tabler/icons-react';
import { effectChip } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { plays, triedRefine } from './reviewScope.js';

/**
 * One visual language for a part, shared by the list, the part card and the timeline (owner,
 * 2026-11-22: "better icon usage, better visual language"). An icon says what; its colour says which
 * family or how it stands: audio / picture / skip for the effect (ContentFilterAdmin.scss
 * `--cf-fx-*`), green = done, orange = needs a look, grey = plays. Every icon keeps its word, as its
 * tooltip and for screen readers; the list's icon key (`LEGEND`) spells them out.
 */
const EFFECT = {
  mute: { Icon: IconVolumeOff, family: 'audio' }, bleep: { Icon: IconWaveSine, family: 'audio' },
  blur: { Icon: IconBlur, family: 'picture' }, 'full-blur': { Icon: IconBlur, family: 'picture' }, blackout: { Icon: IconEyeOff, family: 'picture' },
  skip: { Icon: IconPlayerSkipForward, family: 'skip' }, 'skip-card': { Icon: IconPlayerSkipForward, family: 'skip' },
};
/** audio | picture | skip, or null for a part that plays (or an effect with no family). */
export const effectFamily = (row) => (plays(row) ? null : EFFECT[row?.effect]?.family || null);

const CHANNEL = { said: { Icon: IconMessage, word: 'Said' }, heard: { Icon: IconEar, word: 'Heard' }, shown: { Icon: IconEye, word: 'Shown' } };
const STATUS = {
  Approved: IconCircleCheck, 'Let play': IconCircleCheck, Ignored: IconMinus, Redo: IconRefresh, Plays: IconPlayerPlay, 'Not reviewed': IconCircle,
};
const REFINING = { 'Refining…': IconLoader2, Waiting: IconClock, Queued: IconClock };

/**
 * A part's timing in a word and an icon: { key, word, Icon, unsure }; null when the row carries none.
 * A part refine tried and could not vouch for is `unsure` (amber) whatever its timing says: a word
 * that was not found must never read as a green "Safe window" (review 2026-11-22). A hand fix is the
 * grown-up's own timing, so it is not unsure.
 */
export function timingState(row) {
  if (!row?.timing) return null;
  if (triedRefine(row) && !row.handFixed) {
    if ((row.unsure || []).includes('refine-giveup')) return { key: 'unsure', word: 'Word not found', Icon: IconAlertTriangle, unsure: true };
    if (row.timing === 'rough') return { key: 'rough-left', word: 'Rough after refine', Icon: IconAlertTriangle, unsure: true };
    return { key: 'unsure', word: 'Timing unsure: listen before approving', Icon: IconAlertTriangle, unsure: true };
  }
  if (row.timing === 'refined') return { key: 'refined', word: 'Refined', Icon: IconTarget };
  if (row.timing === 'safe-window') return { key: 'safe-window', word: 'Safe window', Icon: IconBracketsContain };
  if (row.timing === 'rough') return { key: 'rough', word: 'Rough', Icon: IconCircleDashed };
  return null;
}

function Mark({ Icon, word, className, size = 16, spin = false }) {
  return (
    <span className={`cf-ico ${className}${spin ? ' is-spinning' : ''}`} title={word} role="img" aria-label={word}>
      <Icon size={size} stroke={1.8} aria-hidden="true" />
    </span>
  );
}

/** The effect a part gets, in its family's colour; nothing for a part that plays. */
export function EffectIcon({ row, size }) {
  const e = plays(row) ? null : EFFECT[row?.effect];
  return e ? <Mark Icon={e.Icon} word={effectChip(row.effect)} className={`cf-ico--fx is-${e.family}`} size={size} /> : null;
}
/** Said, heard or shown. */
export function ChannelIcon({ row, size = 14 }) {
  const c = CHANNEL[row?.modality];
  return c ? <Mark Icon={c.Icon} word={c.word} className="cf-ico--channel" size={size} /> : null;
}
/** Refined, safe window, rough, or rough after a refine. */
export function TimingIcon({ row, size = 14 }) {
  const t = timingState(row);
  return t ? <Mark Icon={t.Icon} word={t.word} className={`cf-ico--timing is-${t.key}`} size={size} /> : null;
}
/** Where a part stands (ReviewList `rowStatus`): its icon in the status' tone. */
export function StatusIcon({ status, size }) {
  const Icon = STATUS[status.word] || IconCircle;
  return <span className={`cf-ico cf-ico--status is-${status.tone}`} aria-hidden="true"><Icon size={size || 16} stroke={1.8} /></span>;
}
/** A part in a refine: working, or waiting its turn. */
export function RefiningIcon({ state, size = 14 }) {
  const Icon = REFINING[state] || IconClock;
  return <span className={`cf-ico cf-ico--refining${Icon === IconLoader2 ? ' is-spinning' : ''}`} aria-hidden="true"><Icon size={size} stroke={1.8} /></span>;
}

/** The effect as icon and word, for the part card. */
export function EffectTag({ row }) {
  const family = effectFamily(row);
  return <span className={`cf-fx-tag${family ? ` is-${family}` : ''}`}><EffectIcon row={row} size={14} />{effectChip(row.effect)}</span>;
}

const sample = (Icon, className) => <span className={`cf-ico ${className}`} aria-hidden="true"><Icon size={16} stroke={1.8} /></span>;
/** The icon key behind the list's "?": [title, [[icon, words], …]]. */
export const LEGEND = [
  ['Where it stands', [
    [sample(IconCircle, 'cf-ico--status is-open'), 'Not reviewed'],
    [sample(IconCircleCheck, 'cf-ico--status is-done'), 'Approved, or Let play: reviewed'],
    [sample(IconRefresh, 'cf-ico--status is-redo'), 'Redo'],
    [sample(IconPlayerPlay, 'cf-ico--status is-quiet'), 'Plays under your settings'],
  ]],
  ['Effect', [
    [sample(IconVolumeOff, 'cf-ico--fx is-audio'), 'Muted (sound)'],
    [sample(IconWaveSine, 'cf-ico--fx is-audio'), 'Bleeped (sound)'],
    [sample(IconBlur, 'cf-ico--fx is-picture'), 'Blurred (picture)'],
    [sample(IconEyeOff, 'cf-ico--fx is-picture'), 'Picture hidden'],
    [sample(IconPlayerSkipForward, 'cf-ico--fx is-skip'), 'Skipped'],
  ]],
  ['Said, heard or shown', [
    [sample(IconMessage, 'cf-ico--channel'), 'Said'],
    [sample(IconEar, 'cf-ico--channel'), 'Heard (a sound)'],
    [sample(IconEye, 'cf-ico--channel'), 'Shown'],
  ]],
  ['Timing', [
    [sample(IconTarget, 'cf-ico--timing is-refined'), 'Refined'],
    [sample(IconBracketsContain, 'cf-ico--timing is-safe-window'), 'Safe window (a little wide on purpose)'],
    [sample(IconCircleDashed, 'cf-ico--timing is-rough'), 'Rough: not refined yet'],
    [sample(IconAlertTriangle, 'cf-ico--timing is-rough-left'), 'Timing unsure: listen before approving'],
    [sample(IconLoader2, 'cf-ico--refining'), 'Refining now'],
    [sample(IconClock, 'cf-ico--refining'), 'Waiting for a refine'],
  ]],
];
