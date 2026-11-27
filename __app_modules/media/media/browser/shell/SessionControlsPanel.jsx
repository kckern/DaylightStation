// frontend/src/modules/Media/shell/SessionControlsPanel.jsx
// The session controls of the one controls surface — the same for this
// device (Now Playing) and for another screen (its Remote), STEER.1b. The
// status part (this panel) shows what is happening now; the settings live in
// the player's More ⋯ (SessionControlMenuItems, Now Playing ruling 2026-11-27):
//   - the next-episode countdown, visible and cancellable (RQ-STEER-20)
//   - the sleep timer: minutes or end of this item, time left, and later
//     "continue from where the timer was set" (RQ-STEER-12)
//   - Stop after this one (RQ-STEER-20)
//   - Add only, a screen's one-step toggle (RQ-PLAY-10)
//   - the screen's notes, each with Put it back while it can (RQ-STEER-21,
//     RQ-RELY-04) — a speaker that cannot show its notes is steered here too.
// A control the target cannot offer is shown unavailable with a short
// reason, never hidden (STEER.1b/AC2). Failures go through the one outcome
// system (DispatchProvider), never a page notice.
import React, { useContext, useMemo, useState } from 'react';
import { Button, Group, Menu, Text } from '@mantine/core';
import {
  IconMoon, IconPlayerStop, IconPlaylistAdd, IconArrowBackUp, IconPlayerTrackNext, IconX, IconCheck,
} from '@tabler/icons-react';
import { useDisplayClock } from '@/lib/hooks/useDisplayClock.js';
import { useFocusAfterRemoval, useFocusRegion } from '@/lib/ui';
import { useSessionControls, secondsUntil, formatClock } from "../controller/useSessionControls.js";
import { useSessionController } from "../controller/useSessionController.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import mediaLog from "../logging/mediaLog.js";
import { ADD_ONLY_COPY } from "../controller/addOnlyCopy.js";
import "./SessionControls.scss";

export const SLEEP_MINUTE_CHOICES = [15, 30, 45, 60, 90];

export function sleepLabel(sleepTimer, now = Date.now()) {
  if (!sleepTimer) return null;
  if (sleepTimer.mode === 'atEnd') return 'Sleep at end of this item';
  const left = secondsUntil(sleepTimer.endsAt, now) ?? sleepTimer.remainingSeconds;
  return `Sleep in ${formatClock(left)}`;
}

function noteAge(at, now) {
  const t = Date.parse(at ?? '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/**
 * One session-control command runner for a target: logged, pending while in
 * flight, and a failure becomes an outcome naming what could not be changed
 * and where. Shared by the status panel and the More ⋯ menu items.
 */
export function useSessionControlRun(target, targetName = null) {
  const sessionControls = useSessionControls(target);
  const { kind, actions } = sessionControls;
  const outcomes = useContext(DispatchContext);
  const isLocal = kind === 'local';
  const targetId = isLocal ? 'local' : target?.deviceId ?? null;
  const [busy, setBusy] = useState(null);
  const run = async (action, label, thunk, value) => {
    if (!actions || busy) return;
    setBusy(action);
    // This device's controls log their own commands (localSessionControls).
    if (!isLocal) mediaLog.sessionControlCommand({ target: targetId, action, ...(value !== undefined ? { value } : {}) });
    let result;
    try { result = await thunk(); } catch (error) { result = { ok: false, error: error?.message ?? String(error) }; }
    setBusy(null);
    if (result?.ok === false) {
      if (!isLocal) mediaLog.sessionControlFailed({ target: targetId, action, code: result.code ?? null, error: result.error ?? null });
      outcomes?.recordLocal?.({
        kind: 'control', phase: 'failed', item: { title: label },
        reason: result.error ?? result.code ?? 'The screen did not confirm the change',
        targetId, targetName: isLocal ? null : targetName,
      });
    } else if (!isLocal) {
      mediaLog.sessionControlResult({ target: targetId, action, ok: true });
    }
    return result;
  };
  return { ...sessionControls, isLocal, targetId, outcomes, busy, run };
}

export function SessionControlsPanel({ target, targetName = null }) {
  const { controls, actions, available, reason, supports, isLocal, targetId, outcomes, busy, run } = useSessionControlRun(target, targetName);
  const { snapshot, transport } = useSessionController(target);
  const ticking = !!controls?.countdown || controls?.sleepTimer?.mode === 'minutes'
    || (controls?.notes ?? []).some((note) => note.putBack);
  const now = useDisplayClock(ticking);
  const { regionProps, focus } = useFocusRegion(false);
  const countdownFocusProps = useFocusAfterRemoval(focus);

  const hasItem = !!snapshot?.currentItem;
  const countdown = controls?.countdown ?? null;
  const sleepResume = controls?.sleepResume ?? null;
  const notes = useMemo(() => (supports.notes ? (controls?.notes ?? []) : []), [controls?.notes, supports.notes]);

  const putBack = (note) => run('putBack', 'what was playing', async () => {
    const result = await actions.putBack(note.id);
    if (result?.ok !== false) {
      outcomes?.recordLocal?.({
        kind: 'undo', phase: 'confirmed', item: { title: 'what was playing' },
        targetId, targetName: isLocal ? null : targetName,
      });
    }
    return result;
  }, note.id);

  const disabledReason = !available ? reason : null;
  // Nothing happening now: no empty band in the page (the settings are in More ⋯).
  // The region stays mounted (zero height) so focus has somewhere to land when
  // the countdown it was in goes away.
  const empty = !countdown && !sleepResume && !disabledReason && notes.length === 0;
  return (
    <div
      className={`session-controls${empty ? ' session-controls--empty' : ''}`}
      data-testid="session-controls-panel"
      role="group"
      aria-label="Session status"
      {...regionProps}
    >
      {countdown && (
        <div className="session-controls-countdown" data-testid="countdown-banner" role="status" {...countdownFocusProps}>
          <Text size="sm" className="session-controls-countdown-text">
            Next: <strong>{countdown.next?.title ?? 'the next episode'}</strong>
            {/* Announced once when it starts (and when it is cancelled); the
                ticking seconds are for the eye only, not re-read every second. */}
            <span aria-hidden="true">
              {' '}in <span data-testid="countdown-seconds">{secondsUntil(countdown.endsAt, now) ?? countdown.remainingSeconds}</span>s
            </span>
          </Text>
          <Group gap="xs">
            <Button
              data-testid="countdown-start-now" className="session-controls-btn" size="sm" variant="light"
              leftSection={<IconPlayerTrackNext size={16} />}
              onClick={() => run('startNextNow', 'the next episode', () => actions.startNextNow())}
            >
              Play now
            </Button>
            <Button
              data-testid="countdown-cancel" className="session-controls-btn" size="sm" variant="default"
              leftSection={<IconX size={16} />}
              onClick={() => run('cancelCountdown', 'the countdown', () => actions.cancelCountdown())}
            >
              Cancel
            </Button>
          </Group>
        </div>
      )}

      {sleepResume && (
        <div className="session-controls-resume" data-testid="sleep-resume" role="status">
          <Text size="sm">The sleep timer stopped playback.</Text>
          <Group gap="xs">
            {isLocal && hasItem && snapshot?.state !== 'playing' && (
              <Button
                data-testid="sleep-continue-stopped" className="session-controls-btn" size="sm" variant="light"
                onClick={() => { mediaLog.sessionControlCommand({ target: targetId, action: 'continueWhereStopped' }); transport.play?.(); }}
              >
                {/* An at-end sleep leaves the item ended; Play restarts it. */}
                {snapshot?.state === 'ended'
                  ? 'Play it again'
                  : `Continue where it stopped (${formatClock(snapshot?.position ?? 0)})`}
              </Button>
            )}
            <Button
              data-testid="sleep-continue-set" className="session-controls-btn" size="sm" variant="light"
              onClick={() => run('resumeSleep', 'the sleep timer', () => actions.resumeSleep())}
            >
              Continue from {formatClock(sleepResume.position)}, where the timer was set
            </Button>
          </Group>
        </div>
      )}

      {disabledReason && (
        <Text size="xs" className="session-controls-hint" role="status" data-testid="session-controls-unavailable">
          {disabledReason}
        </Text>
      )}

      {notes.length > 0 && (
        <ul className="session-controls-notes" data-testid="screen-notes" aria-label="Changes made from other devices">
          {notes.map((note) => {
            const until = Date.parse(note.putBack?.availableUntil ?? '');
            const canPutBack = Number.isFinite(until) && until > now;
            return (
              <li key={note.id} className="session-controls-note" data-testid={`screen-note-${note.id}`}>
                <Text size="sm" className="session-controls-note-label">
                  <span data-testid="remote-note-label">{note.label}</span>
                  {note.count > 1 ? ` (${note.count}×)` : ''}
                  <span className="session-controls-note-age"> · {noteAge(note.at, now)}</span>
                </Text>
                {canPutBack && (
                  <Button
                    data-testid="remote-note-put-back"
                    className="session-controls-btn"
                    size="sm"
                    variant="light"
                    leftSection={<IconArrowBackUp size={16} />}
                    disabled={busy === 'putBack'}
                    onClick={() => putBack(note)}
                  >
                    Put it back
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A person's words for Add only (RQ-PLAY-10): one source, `controller/addOnlyCopy.js`. */
export { ADD_ONLY_COPY };

/**
 * The session settings as items of the player's More ⋯ (Now Playing ruling
 * 2026-11-27): Sleep timer (its choices open in place), Stop after this one,
 * Queue what others send. Toggles keep the menu open so the new state shows.
 */
export function SessionControlMenuItems({ target, targetName = null }) {
  const { controls, actions, available, supports, run, busy } = useSessionControlRun(target, targetName);
  const { snapshot } = useSessionController(target);
  const now = useDisplayClock(controls?.sleepTimer?.mode === 'minutes');
  const [sleepOpen, setSleepOpen] = useState(false);
  const hasItem = !!snapshot?.currentItem;
  const sleepTimer = controls?.sleepTimer ?? null;
  const disabled = !available || !actions;
  const stopAfter = controls?.stopAfterCurrent === true;
  const addOnly = controls?.addOnly === true;
  return (
    <>
      <Menu.Item
        data-testid="sleep-timer-button"
        className="session-controls-menu-item"
        leftSection={<IconMoon size={16} />}
        closeMenuOnClick={false}
        disabled={disabled}
        aria-expanded={sleepOpen}
        onClick={() => setSleepOpen((open) => !open)}
      >
        {sleepTimer ? <span data-testid="sleep-timer-left">{sleepLabel(sleepTimer, now)}</span> : 'Sleep timer'}
      </Menu.Item>
      {sleepOpen && !disabled && (
        <div className="np-more-sub" role="group" aria-label="Stop playback" data-testid="sleep-timer-menu">
          {SLEEP_MINUTE_CHOICES.map((minutes) => (
            <Menu.Item
              key={minutes}
              data-testid={`sleep-option-${minutes}`}
              className="session-controls-menu-item np-more-sub-item"
              onClick={() => { setSleepOpen(false); run('sleepTimer', 'the sleep timer', () => actions.setSleepTimer({ minutes }), minutes); }}
            >
              In {minutes} minutes
            </Menu.Item>
          ))}
          <Menu.Item
            data-testid="sleep-option-end"
            className="session-controls-menu-item np-more-sub-item"
            disabled={!hasItem}
            onClick={() => { setSleepOpen(false); run('sleepTimer', 'the sleep timer', () => actions.setSleepTimer({ atEnd: 'item' }), 'item'); }}
          >
            At the end of this item
          </Menu.Item>
          {sleepTimer && (
            <Menu.Item
              data-testid="sleep-option-off"
              className="session-controls-menu-item np-more-sub-item"
              onClick={() => { setSleepOpen(false); run('cancelSleepTimer', 'the sleep timer', () => actions.cancelSleepTimer()); }}
            >
              Turn the sleep timer off
            </Menu.Item>
          )}
        </div>
      )}
      <Menu.Item
        data-testid="stop-after-current"
        className="session-controls-menu-item"
        role="menuitemcheckbox"
        aria-checked={stopAfter}
        aria-pressed={stopAfter}
        closeMenuOnClick={false}
        leftSection={stopAfter ? <IconCheck size={16} /> : <IconPlayerStop size={16} />}
        disabled={disabled || !hasItem || busy === 'setStopAfterCurrent'}
        onClick={() => run('setStopAfterCurrent', 'Stop after this one',
          () => actions.setStopAfterCurrent(!stopAfter), !stopAfter)}
      >
        Stop after this one
      </Menu.Item>
      <Menu.Item
        data-testid="add-only-toggle"
        className="session-controls-menu-item np-more-explained"
        role="menuitemcheckbox"
        aria-checked={addOnly}
        aria-pressed={addOnly}
        closeMenuOnClick={false}
        leftSection={addOnly ? <IconCheck size={16} /> : <IconPlaylistAdd size={16} />}
        disabled={disabled || !supports.addOnly || busy === 'setAddOnly'}
        onClick={() => run('setAddOnly', ADD_ONLY_COPY.label, () => actions.setAddOnly(!addOnly), !addOnly)}
      >
        <span className="np-more-label">{ADD_ONLY_COPY.label}</span>
        <span className="np-more-explain" data-testid={supports.addOnly ? 'add-only-hint' : 'add-only-unsupported'}>
          {supports.addOnly ? ADD_ONLY_COPY.explain : ADD_ONLY_COPY.unavailable}
        </span>
      </Menu.Item>
    </>
  );
}

export default SessionControlsPanel;
