// frontend/src/modules/Media/cast/DispatchProgressTray.jsx
// The one outcome tray for /media (PR-6, RELY.1a–RELY.6a). Every play, add,
// send, queue edit and playback problem reports here, the same way whichever
// control started it:
//  - this device: quiet and brief ("Playing Arrival here"), with Undo while
//    its window is open;
//  - another screen: named, with its steps in words that fit the screen
//    ("Turning on TV…" / "Waking the speaker…"), then "▶ Playing on <screen>"
//    with Steer it. A row is NOT cleared the instant the load succeeds — it
//    waits for the backend playback watchdog's trailing `playback` step so the
//    person gets honest confirmation, or "may not have started" with Steer it
//    and Try again;
//  - problems (failed, not sent, skipped) never auto-clear; each has its own
//    Retry and a way to send that attempt to another screen.
// One polite live region announces the newest outcome. Never modal (N1.3).
import React, { useEffect, useMemo, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconAlertCircle, IconRefresh, IconX, IconDeviceRemote, IconPlayerPlayFilled, IconArrowBackUp, IconDevices, IconCheck, IconPlayerStopFilled, IconPlayerSkipForwardFilled, IconRotate } from '@tabler/icons-react';
import { useDispatch } from './useDispatch.js';
import { useDevice } from '../fleet/useDevice.js';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { useNav } from '../shell/NavProvider.jsx';
import { friendlyStepLabel, friendlyStepPhrase, deviceKind, deviceKindNoun } from './castCopy.js';
import { rowPhase } from './dispatchRowPhase.js';
import mediaLog from '../logging/mediaLog.js';
import './Cast.scss';

// Confirmed playback lingers long enough to be seen, then clears.
export const CONFIRMED_LINGER_MS = 8_000;
// A quiet confirmation on this device: the result is already visible here.
export const LOCAL_LINGER_MS = 2_500;
// "Sent" rows without a playback resolution eventually clear on their own:
// the backend watchdog resolves within ~90s (a 'confirmed' or 'timeout'
// broadcast), so a row still unresolved past that will never get one.
// Generous, not 3 seconds.
export const SENT_RESOLUTION_TIMEOUT_MS = 100_000;
// A play that continued from a saved spot keeps its Start over reachable long
// enough to notice the position once the picture is up (PLAY.4a).
export const START_OVER_LINGER_MS = 15_000;

const PROBLEM_PHASES = new Set(['failed', 'not-sent', 'skipped', 'unconfirmed', 'waiting', 'library-unavailable']);
const RETRYABLE_PHASES = new Set(['failed', 'not-sent', 'skipped', 'unconfirmed', 'waiting', 'library-unavailable']);
// A local item the Player is waiting on can be skipped by the person.
const SKIPPABLE_PHASES = new Set(['waiting', 'library-unavailable']);

function ordinal(value) {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

// PLAY.2a/AC3, PLAY.7a/AC2: a whole collection says how many items went there.
function itemsCount(d) {
  const n = d.outcomeIdentity?.count ?? d.count;
  return Number.isInteger(n) && n > 1 ? n : null;
}
function titleWithCount(title, d) {
  const n = itemsCount(d);
  return n && title ? `${title} (${n} items)` : title;
}

function StatusIcon({ phase, quiet }) {
  if (quiet) return <IconCheck size={14} className="cast-tray-icon--quiet" aria-hidden />;
  if (phase === 'running' || phase === 'sent') return <span className="cast-tray-spinner" aria-hidden />;
  if (phase === 'confirmed') return <IconPlayerPlayFilled size={16} className="cast-tray-icon--ok" aria-hidden />;
  if (phase === 'unconfirmed') return <IconAlertCircle size={16} className="cast-tray-icon--warn" aria-hidden />;
  return <IconAlertCircle size={16} className="cast-tray-icon--fail" aria-hidden />;
}

const LOCAL_VERB = {
  play: (t, at) => `Playing ${t} ${at}`,
  shuffle: (t, at) => `Shuffling ${t} ${at}`,
  add: (t, at) => `Added ${t} ${at}`,
  playNext: (t, at) => `${t} plays next ${at}`,
  playFirst: (t, at) => `${t} plays first ${at}`,
  remove: (t, at) => `Removed ${t} from the queue ${at}`,
  clear: (_t, at) => `Cleared the queue ${at}`,
  undo: (t, at) => `Put back ${t} ${at}`,
  // Batch B: session controls, line up and screen-to-screen moves.
  control: (t, at) => `Changed ${t} ${at}`,
  lineUp: (t, at) => `Lined up ${t} ${at}`,
  move: (t, at) => `Moved ${t} ${at === 'here' ? 'here' : at.replace(/^on /, 'to ')}`,
};
const LOCAL_FAILED_VERB = {
  play: 'play', shuffle: 'shuffle', add: 'add', playNext: 'add', playFirst: 'add',
  remove: 'remove', clear: 'clear the queue for', undo: 'put back',
  control: 'change', lineUp: 'line up', move: 'move',
};

// Household list edits (FIND.12a/13a, FIND.10a/AC6): named plainly, wherever
// they were made. They are not plays, so they never offer Retry or another
// screen; a removal carries its Undo on the record itself.
const HOUSEHOLD_COPY = {
  favourite: { running: t => `Adding ${t} to favourites…`, done: t => `Added ${t} to favourites`, failed: t => `Couldn't add ${t} to favourites` },
  unfavourite: { running: t => `Removing ${t} from favourites…`, done: t => `Removed ${t} from favourites`, failed: t => `Couldn't remove ${t} from favourites` },
  hide: { running: t => `Removing ${t} from the household list…`, done: t => `Removed ${t} from the household list`, failed: t => `Couldn't remove ${t} from the household list` },
  watched: { running: t => `Marking ${t} watched…`, done: t => `Marked ${t} watched`, failed: t => `Couldn't mark ${t} watched` },
  unwatched: { running: t => `Marking ${t} unwatched…`, done: t => `Marked ${t} unwatched`, failed: t => `Couldn't mark ${t} unwatched` },
  moveHere: { running: t => `Moving ${t} here…`, done: (t, _at, d) => `Moved ${t} here${d?.command?.sourceName ? ` from ${d.command.sourceName}` : ''}`, failed: t => `Couldn't move ${t} here` },
  startOver: { done: (t, at) => `Started ${t} over ${at}`, failed: (t, at) => `Couldn't start ${t} over ${at}` },
};
export const HOUSEHOLD_KINDS = new Set(Object.keys(HOUSEHOLD_COPY));

// PLAY.4a: a play that continued from a saved spot says where it continued.
function resumedLine(d) {
  if (!d.startOver || !Number.isFinite(d.resumedFrom) || d.resumedFrom <= 0) return null;
  const minutes = Math.floor(d.resumedFrom / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const at = minutes < 1 ? 'the start' : h ? `${h} h${m ? ` ${m} m` : ''}` : `${m} m`;
  return `Continuing from ${at}`;
}

function localCopy(d, phase, name) {
  // House-wide actions (Pause all, Stop all, …) carry their own sentence:
  // they name several screens, not one item on one screen.
  if (d.command?.copy?.primary) return { primary: d.command.copy.primary, secondary: d.command.copy.secondary ?? null };
  const baseTitle = d.item?.title ?? d.title ?? 'it';
  const title = ['play', 'shuffle', 'add', 'playNext', 'playFirst'].includes(d.kind) ? titleWithCount(baseTitle, d) : baseTitle;
  const at = d.distance === 'here' ? 'here' : `on ${d.targetName ?? name}`;
  if (HOUSEHOLD_COPY[d.kind]) {
    const copy = HOUSEHOLD_COPY[d.kind];
    if (phase === 'failed') return { primary: copy.failed(title, at), secondary: d.reason ?? null };
    if (phase === 'running' && copy.running) return { primary: copy.running(title, at), secondary: null };
    return { primary: copy.done(title, at, d), secondary: null };
  }
  if (d.kind === 'playback') {
    // RELY.5a: name the item, the screen (this device, or a steered one), and what plays instead.
    const where = d.distance === 'here' ? 'this device' : (d.targetName ?? name ?? 'that screen');
    if (phase === 'waiting') {
      return { primary: `Waiting for ${title} — the file is being repaired`, secondary: d.distance === 'here' ? 'On this device' : `On ${where}` };
    }
    if (phase === 'library-unavailable') {
      return { primary: 'Library unavailable', secondary: `${title} is waiting for its file on ${where}` };
    }
    if (phase === 'skipped' && d.reason === 'file-unavailable') {
      return {
        primary: `${title} skipped — file unavailable`,
        secondary: d.replacement?.title ? `Now playing ${d.replacement.title}` : 'Nothing else is queued.',
      };
    }
    if (phase === 'skipped') {
      return {
        primary: d.reason === 'stalled'
          ? `${title} stopped making progress on ${where}`
          : `Couldn't keep playing ${title} on ${where}`,
        secondary: d.replacement?.title
          ? `Skipped it. Now playing ${d.replacement.title}`
          : 'Skipped it.',
      };
    }
    return {
      primary: `Couldn't play ${title} on ${where}`,
      secondary: d.replacement?.title ? `Now playing ${d.replacement.title}` : 'Nothing else is queued.',
    };
  }
  if (phase === 'failed') {
    return {
      primary: `Couldn't ${LOCAL_FAILED_VERB[d.kind] ?? 'do that for'} ${title} ${d.kind === 'move' && at !== 'here' ? at.replace(/^on /, 'to ') : at}`,
      secondary: d.reason ?? null,
    };
  }
  if (d.kind === 'undo' && d.command?.undid === 'clear') {
    return { primary: `Put the queue back ${at}`, secondary: null };
  }
  if (d.kind === 'undo' && d.command?.undid && d.command.undid !== 'remove') {
    return { primary: `Took back ${title} ${at}`, secondary: null };
  }
  const verb = LOCAL_VERB[d.kind] ?? LOCAL_VERB.play;
  const from = d.kind === 'move' && d.command?.sourceName ? ` from ${d.command.sourceName}` : '';
  return {
    primary: `${verb(title, at)}${from}`,
    secondary: Number.isInteger(d.ordinal) && ['add', 'playNext', 'playFirst'].includes(d.kind)
      ? `${ordinal(d.ordinal)} in queue`
      : resumedLine(d),
  };
}

function notSentReason(d, kind) {
  const noun = deviceKindNoun(kind);
  if (d.failedStep === 'power' || d.failedStep === 'verify') return `The ${noun} did not turn on`;
  if (d.failedStep === 'input') return `The ${noun}'s remote input is not ready`;
  return `The ${noun} isn't connected`;
}

function farCopy(d, phase, name, kind) {
  const rawTitle = d.item?.title ?? d.title ?? null;
  const title = phase === 'confirmed' ? titleWithCount(rawTitle, d) : rawTitle;
  const isAdd = d.kind === 'add' || d.operation === 'add';
  switch (phase) {
    case 'running': {
      const last = d.steps?.[d.steps.length - 1];
      return {
        primary: isAdd
          ? `${title ? `Adding ${title} to ${name}` : `Adding to ${name}`}${d.appliedAs === 'add' ? ' (Add only is on)' : ''}`
          : (title ? `Sending ${title} to ${name}` : `Sending to ${name}`),
        secondary: last ? friendlyStepLabel(last.step, kind) : 'Starting…',
      };
    }
    case 'sent':
      return { primary: `Sent to ${name}`, secondary: title };
    case 'confirmed':
      if (isAdd && d.appliedAs === 'add') {
        // PLAY.10a/AC2: the screen's Add only turned this Play into an add.
        const place = d.outcomeIdentity?.ordinal ?? d.outcomeIdentity?.queueLength;
        return {
          primary: `${title ? `Added ${title} to ${name}` : `Added to ${name}`} (Add only is on)`,
          secondary: Number.isInteger(place) ? `${ordinal(place)} in line` : null,
        };
      }
      if (isAdd) {
        return {
          primary: title ? `Added ${title} to ${name}` : `Added to ${name}`,
          secondary: Number.isInteger(d.outcomeIdentity?.queueLength)
            ? `${ordinal(d.outcomeIdentity.ordinal ?? d.outcomeIdentity.queueLength)} in queue`
            : null,
        };
      }
      return { primary: `▶ Playing on ${name}`, secondary: title };
    case 'unconfirmed':
      if (isAdd) return { primary: `The item may not have been added to ${name}`, secondary: title };
      return {
        primary: `It may not have started on ${name}`,
        secondary: title ? `${title} · check it or try again` : 'Check it or try again',
      };
    case 'not-sent':
      return {
        primary: `Not sent to ${name}`,
        secondary: [title, notSentReason(d, kind)].filter(Boolean).join(' · '),
      };
    case 'failed': {
      const phrase = friendlyStepPhrase(d.failedStep, kind);
      return {
        primary: isAdd ? `Couldn't add ${title ?? 'it'} to ${name}` : `Couldn't play ${title ?? 'it'} on ${name}`,
        secondary: phrase ? `Stopped while ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}` : (d.error ?? null),
      };
    }
    default:
      return { primary: name, secondary: null };
  }
}

/** Other screens this attempt can be sent to: content screens, not browsers. */
function otherScreens(devices, targetId) {
  return (devices ?? []).filter((device) => typeof device?.id === 'string'
    && device.id !== targetId
    && !device.id.startsWith('browser:')
    && (device.content_control || device.fleet === true));
}

function SendElsewhere({ d, sendElsewhere }) {
  const { devices } = useFleetContext();
  const [open, setOpen] = useState(false);
  const choices = otherScreens(devices, d.targetId ?? d.deviceId);
  if (choices.length === 0) return null;
  return (
    <>
      <UnstyledButton
        data-testid={`dispatch-elsewhere-${d.attemptId ?? d.dispatchId}`}
        className="cast-tray-action"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconDevices size={14} aria-hidden /> Another screen…
      </UnstyledButton>
      {open && (
        <div className="cast-tray-elsewhere" data-testid={`dispatch-elsewhere-list-${d.attemptId ?? d.dispatchId}`} role="group" aria-label="Send to another screen">
          {choices.map((device) => (
            <UnstyledButton
              key={device.id}
              className="cast-tray-action"
              onClick={() => { setOpen(false); sendElsewhere?.(d.attemptId ?? d.dispatchId, device.id); }}
            >
              {deviceName(device, device.id)}
            </UnstyledButton>
          ))}
        </div>
      )}
    </>
  );
}

function UndoAction({ d, removeDispatch, recordLocal }) {
  const undo = d.undo;
  const [, force] = useState(0);
  const remaining = undo ? undo.expiresAt - Date.now() : 0;
  useEffect(() => {
    if (!undo || remaining <= 0) return undefined;
    const timer = setTimeout(() => force((n) => n + 1), remaining);
    return () => clearTimeout(timer);
  }, [undo, remaining]);
  if (!undo || typeof undo.run !== 'function' || remaining <= 0) return null;
  const run = async () => {
    const attemptId = d.attemptId ?? d.dispatchId;
    mediaLog.outcomeUndo({ attemptId, targetId: d.targetId ?? d.deviceId, operationId: undo.operationId });
    try {
      const result = await undo.run(undo.operationId);
      if (result?.ok === false) throw new Error(result.reason ?? result.code ?? 'Undo failed');
      removeDispatch(attemptId);
      // RELY.1a/AC1: the undo is itself an action that changes the queue, so it
      // gets its own short confirmation naming the item and the screen.
      const far = d.distance === 'far';
      recordLocal?.({
        kind: 'undo', phase: 'confirmed', item: d.item ?? { title: d.title, contentId: d.contentId },
        command: { undid: d.kind ?? d.operation ?? null },
        ...(far || d.distance === 'direct' ? { targetId: d.targetId ?? d.deviceId, targetName: d.targetName ?? null } : {}),
      });
      mediaLog.outcomeUndone({ attemptId, targetId: d.targetId ?? d.deviceId, undid: d.kind ?? d.operation ?? null });
    } catch (error) {
      mediaLog.outcomeUndoFailed({ attemptId, operationId: undo.operationId, error: error?.message ?? String(error) });
      recordLocal?.({ kind: 'undo', phase: 'failed', item: d.item, reason: error?.message ?? 'Undo failed' });
    }
  };
  return (
    <UnstyledButton data-testid="item-action-undo" className="cast-tray-action" onClick={run}>
      <IconArrowBackUp size={14} aria-hidden /> Undo
    </UnstyledButton>
  );
}

function rowText(d, phase, name, kind) {
  return d.distance === 'here' || d.distance === 'direct' ? localCopy(d, phase, name) : farCopy(d, phase, name, kind);
}

function TrayRow({ d, retry, removeDispatch, sendElsewhere, recordLocal, stopAttempt, skipLocal, startOver }) {
  const isLocal = d.distance === 'here' || d.distance === 'direct';
  const targetId = d.targetId ?? d.deviceId;
  const { device } = useDevice(d.distance === 'here' ? null : targetId);
  const name = deviceName(device, targetId);
  const kind = deviceKind(device);
  const { push } = useNav();
  const phase = rowPhase(d);
  const attemptId = d.attemptId ?? d.dispatchId;
  const quiet = d.distance === 'here' && !PROBLEM_PHASES.has(phase);

  // Row lifecycle: confirmed lingers briefly; "sent" clears only after the
  // watchdog window has certainly passed; a quiet local confirmation clears
  // after its Undo window. Problems NEVER auto-clear — a problem the person
  // hasn't seen isn't handled.
  useEffect(() => {
    let ms = null;
    // A local queue action resolves at once; a household write or Move here
    // waits on the server or two screens, so its running row stays until it
    // resolves (a failure must never be dropped unseen).
    if (isLocal && (phase === 'confirmed' || (phase === 'running' && !HOUSEHOLD_KINDS.has(d.kind)))) {
      ms = Math.max(LOCAL_LINGER_MS, d.undo ? d.undo.expiresAt - Date.now() : 0);
    } else if (!isLocal && phase === 'confirmed') ms = Math.max(CONFIRMED_LINGER_MS, d.undo ? d.undo.expiresAt - Date.now() : 0);
    else if (!isLocal && phase === 'sent') ms = SENT_RESOLUTION_TIMEOUT_MS;
    // Start over (PLAY.4a) must stay reachable long enough to be tapped.
    if (ms != null && d.startOver === true && phase !== 'sent') ms = Math.max(ms, START_OVER_LINGER_MS);
    if (ms == null) return undefined;
    const t = setTimeout(() => removeDispatch(attemptId), ms);
    return () => clearTimeout(t);
  }, [phase, quiet, isLocal, attemptId, removeDispatch, d.undo, d.startOver, d.kind]);

  const openRemote = () => {
    push('peek', { deviceId: targetId });
    removeDispatch(attemptId);
  };

  // O1: inside the 10s window a far start offers Undo; once it has passed,
  // a start that is still waking/loading offers Stop (queue kept,
  // RQ-STEER-10) so a mis-sent cold wake can be aborted from here.
  const [, rerender] = useState(0);
  const undoLeft = d.undo ? d.undo.expiresAt - Date.now() : 0;
  useEffect(() => {
    if (undoLeft <= 0) return undefined;
    const timer = setTimeout(() => rerender((n) => n + 1), undoLeft + 1);
    return () => clearTimeout(timer);
  }, [undoLeft]);
  const showStop = !isLocal && (phase === 'running' || phase === 'sent') && undoLeft <= 0 && typeof stopAttempt === 'function';

  const { primary, secondary } = rowText(d, phase, name, kind);
  const showRemote = !isLocal && (phase === 'confirmed' || phase === 'unconfirmed');
  const retryLabel = phase === 'unconfirmed' ? 'Try again' : 'Retry';
  const showRetry = RETRYABLE_PHASES.has(phase) && !HOUSEHOLD_KINDS.has(d.kind)
    && (isLocal ? !!(d.command?.item ?? d.item)?.contentId : true);
  // PLAY.4a: the confirmation of a play that continued from a saved spot.
  const showStartOver = d.startOver === true && typeof startOver === 'function'
    && ['running', 'sent', 'confirmed'].includes(phase);
  const dismissible = PROBLEM_PHASES.has(phase);

  return (
    <div
      data-testid={`dispatch-row-${attemptId}`}
      data-phase={phase}
      data-target={targetId}
      className={`cast-tray-row cast-tray-row--${phase}${quiet ? ' cast-tray-row--quiet' : ''}`}
    >
      <StatusIcon phase={phase} quiet={quiet} />
      <div className="cast-tray-text">
        <span className="cast-tray-primary">{primary}</span>
        {secondary && <span className="cast-tray-secondary">{secondary}</span>}
      </div>
      <div className="cast-tray-actions">
        <UndoAction d={d} removeDispatch={removeDispatch} recordLocal={recordLocal} />
        {showStartOver && (
          <UnstyledButton data-testid={`dispatch-start-over-${attemptId}`} onClick={() => startOver(attemptId)} className="cast-tray-action">
            <IconRotate size={14} aria-hidden /> Start over
          </UnstyledButton>
        )}
        {showStop && (
          <UnstyledButton data-testid={`dispatch-stop-${attemptId}`} aria-label={`Stop ${name}`} onClick={() => stopAttempt(attemptId)} className="cast-tray-action">
            <IconPlayerStopFilled size={14} aria-hidden /> Stop
          </UnstyledButton>
        )}
        {showRemote && (
          <UnstyledButton data-testid={`dispatch-remote-${attemptId}`} onClick={openRemote} className="cast-tray-action">
            <IconDeviceRemote size={14} aria-hidden /> Steer it
          </UnstyledButton>
        )}
        {d.distance === 'here' && SKIPPABLE_PHASES.has(phase) && typeof skipLocal === 'function' && (
          <UnstyledButton data-testid={`dispatch-skip-${attemptId}`} onClick={() => skipLocal(attemptId)} className="cast-tray-action">
            <IconPlayerSkipForwardFilled size={14} aria-hidden /> Skip now
          </UnstyledButton>
        )}
        {showRetry && (
          <UnstyledButton data-testid={`dispatch-retry-${attemptId}`} onClick={() => retry(attemptId)} className="cast-tray-action">
            <IconRefresh size={14} aria-hidden /> {retryLabel}
          </UnstyledButton>
        )}
        {showRetry && phase !== 'unconfirmed' && <SendElsewhere d={d} sendElsewhere={sendElsewhere} />}
        {dismissible && (
          <UnstyledButton
            data-testid={`dispatch-dismiss-${attemptId}`}
            aria-label="Dismiss"
            onClick={() => removeDispatch(attemptId)}
            className="cast-tray-dismiss"
          >
            <IconX size={14} aria-hidden />
          </UnstyledButton>
        )}
      </div>
    </div>
  );
}

/** Words for the live region: the newest outcome, as one sentence. */
function Announcer({ records }) {
  const latest = useMemo(() => {
    let newest = null;
    for (const d of records) {
      if (!newest || String(d.updatedAt ?? d.createdAt ?? '') >= String(newest.updatedAt ?? newest.createdAt ?? '')) newest = d;
    }
    return newest;
  }, [records]);
  return (
    <div data-testid="media-outcome-announcer" className="media-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {latest ? <AnnouncedText d={latest} /> : null}
    </div>
  );
}

function AnnouncedText({ d }) {
  const targetId = d.targetId ?? d.deviceId;
  const { device } = useDevice(d.distance === 'here' ? null : targetId);
  const phase = rowPhase(d);
  const { primary, secondary } = rowText(d, phase, deviceName(device, targetId), deviceKind(device));
  return <>{[primary, secondary].filter(Boolean).join('. ')}</>;
}

export function DispatchProgressTray() {
  const { dispatches, outcomes, retry, removeDispatch, sendElsewhere, recordLocal, stopAttempt, skipLocal, startOver } = useDispatch();
  const records = [...(outcomes ?? dispatches).values()];
  return (
    <>
      <Announcer records={records} />
      {records.length > 0 && (
        <div data-testid="dispatch-tray" className="cast-tray">
          {records.map((d) => (
            <TrayRow
              key={d.attemptId ?? d.dispatchId}
              d={d}
              retry={retry}
              removeDispatch={removeDispatch}
              sendElsewhere={sendElsewhere}
              recordLocal={recordLocal}
              stopAttempt={stopAttempt}
              skipLocal={skipLocal}
              startOver={startOver}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default DispatchProgressTray;
