// frontend/src/modules/Media/shell/SessionControlsPanel.jsx
// The session controls row of the one controls surface — the same for this
// device (Now Playing) and for another screen (its Remote), STEER.1b:
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
  IconMoon, IconPlayerStop, IconPlaylistAdd, IconArrowBackUp, IconPlayerTrackNext, IconX,
} from '@tabler/icons-react';
import { useSessionControls, useSecondTick, secondsUntil, formatClock } from '../controller/useSessionControls.js';
import { useSessionController } from '../controller/useSessionController.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import mediaLog from '../logging/mediaLog.js';
import './SessionControls.scss';

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

export function SessionControlsPanel({ target, targetName = null }) {
  const { kind, controls, actions, available, reason, supports } = useSessionControls(target);
  const { snapshot, transport } = useSessionController(target);
  const outcomes = useContext(DispatchContext);
  const isLocal = kind === 'local';
  const targetId = isLocal ? 'local' : target?.deviceId ?? null;
  const ticking = !!controls?.countdown || controls?.sleepTimer?.mode === 'minutes'
    || (controls?.notes ?? []).some((note) => note.putBack);
  const now = useSecondTick(ticking);
  const [busy, setBusy] = useState(null);

  const hasItem = !!snapshot?.currentItem;
  const sleepTimer = controls?.sleepTimer ?? null;
  const countdown = controls?.countdown ?? null;
  const sleepResume = controls?.sleepResume ?? null;
  const notes = useMemo(() => (supports.notes ? (controls?.notes ?? []) : []), [controls?.notes, supports.notes]);

  // One command: logged, pending while in flight, and a failure becomes an
  // outcome naming what could not be changed and where.
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
  const controlsDisabled = !available || !actions;

  return (
    <div className="session-controls" data-testid="session-controls-panel">
      {countdown && (
        <div className="session-controls-countdown" data-testid="countdown-banner" role="status">
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

      <Group gap="xs" className="session-controls-row" wrap="wrap">
        <Menu position="top-start" withinPortal shadow="md" disabled={controlsDisabled}>
          <Menu.Target>
            <Button
              data-testid="sleep-timer-button"
              className="session-controls-btn"
              size="sm"
              variant={sleepTimer ? 'light' : 'default'}
              leftSection={<IconMoon size={16} />}
              aria-pressed={!!sleepTimer}
              disabled={controlsDisabled}
            >
              {sleepTimer ? <span data-testid="sleep-timer-left">{sleepLabel(sleepTimer, now)}</span> : 'Sleep timer'}
            </Button>
          </Menu.Target>
          <Menu.Dropdown data-testid="sleep-timer-menu">
            <Menu.Label>Stop playback</Menu.Label>
            {SLEEP_MINUTE_CHOICES.map((minutes) => (
              <Menu.Item
                key={minutes}
                data-testid={`sleep-option-${minutes}`}
                className="session-controls-menu-item"
                onClick={() => run('sleepTimer', 'the sleep timer', () => actions.setSleepTimer({ minutes }), minutes)}
              >
                In {minutes} minutes
              </Menu.Item>
            ))}
            <Menu.Item
              data-testid="sleep-option-end"
              className="session-controls-menu-item"
              disabled={!hasItem}
              onClick={() => run('sleepTimer', 'the sleep timer', () => actions.setSleepTimer({ atEnd: 'item' }), 'item')}
            >
              At the end of this item
            </Menu.Item>
            {sleepTimer && (
              <Menu.Item
                data-testid="sleep-option-off"
                className="session-controls-menu-item"
                onClick={() => run('cancelSleepTimer', 'the sleep timer', () => actions.cancelSleepTimer())}
              >
                Turn the sleep timer off
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>

        <Button
          data-testid="stop-after-current"
          className="session-controls-btn"
          size="sm"
          variant={controls?.stopAfterCurrent ? 'light' : 'default'}
          leftSection={<IconPlayerStop size={16} />}
          aria-pressed={controls?.stopAfterCurrent === true}
          disabled={controlsDisabled || !hasItem || busy === 'setStopAfterCurrent'}
          onClick={() => run('setStopAfterCurrent', 'Stop after this one',
            () => actions.setStopAfterCurrent(!controls?.stopAfterCurrent), !controls?.stopAfterCurrent)}
        >
          Stop after this one{controls?.stopAfterCurrent ? ': on' : ''}
        </Button>

        <Button
          data-testid="add-only-toggle"
          className="session-controls-btn"
          size="sm"
          variant={controls?.addOnly ? 'light' : 'default'}
          leftSection={<IconPlaylistAdd size={16} />}
          aria-pressed={controls?.addOnly === true}
          disabled={controlsDisabled || !supports.addOnly || busy === 'setAddOnly'}
          onClick={() => run('setAddOnly', 'Add only', () => actions.setAddOnly(!controls?.addOnly), !controls?.addOnly)}
        >
          Add only: {controls?.addOnly ? 'on' : 'off'}
        </Button>
      </Group>
      {available && !supports.addOnly && (
        <Text size="xs" className="session-controls-hint" data-testid="add-only-unsupported">
          {actions?.unsupportedReasons?.addOnly ?? 'Add only is not available here'}
        </Text>
      )}
      {controls?.addOnly && (
        <Text size="xs" className="session-controls-hint" data-testid="add-only-hint">
          Plays from other devices are added to this queue instead of replacing it.
        </Text>
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

export default SessionControlsPanel;
