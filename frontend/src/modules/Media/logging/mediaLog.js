// frontend/src/modules/Media/logging/mediaLog.js
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

// `sessionLog` is what makes these events DURABLE. The backend session-file
// transport gates on `context.app && context.sessionLog`
// (0_system/logging/transports/sessionFile.mjs) — without the flag every event
// below is stdout-only and dies with the container. On 2026-08-16 the durable
// record of a real incident held 13 events, all of them from ContentCombobox
// (which sets its own sessionLog); the entire §10.1 taxonomy — playback,
// stalls, dispatch, errors — was missing, and the diagnosis survived only
// because `docker logs` happened not to have rolled.
//
// Re-parented (Phase 6, DS migration) onto lib/ui's createAppLogger — the
// same facade every other DS-migrated app uses. `sessionLog: true` now comes
// from MediaApp.jsx's mount effect calling `configure({ context: { app:
// 'media', sessionLog: true } })` on the shared root logger (Logger.js),
// same pattern as LifeApp/FitnessApp/PianoApp, rather than being set
// per-child here.
const logger = createAppLogger('media');
function base() {
  return logger;
}

const SAMPLED = { maxPerMinute: 20, aggregate: true };
const SAMPLED_STATE = { maxPerMinute: 30, aggregate: true };

function info(event) {
  return (data) => base().info(event, data);
}
function debug(event) {
  return (data) => base().debug(event, data);
}
function warn(event) {
  return (data) => base().warn(event, data);
}
function error(event) {
  return (data) => base().error(event, data);
}
function sampled(event, opts = SAMPLED) {
  return (data) => base().sampled(event, data, opts);
}

// Per docs/reference/media/media-app-technical.md §10.1
export const mediaLog = {
  mounted:                info('media-app.mounted'),
  unmounted:              info('media-app.unmounted'),
  sessionCreated:         info('session.created'),
  sessionReset:           info('session.reset'),
  sessionResumed:         info('session.resumed'),
  sessionRestoredPaused:  info('session.restored-paused'),
  sessionRestoreReleased: info('session.restore-released'),
  sessionRestoreDiscarded: warn('session.restore-discarded'),
  sessionStartFresh:      info('session.start-fresh'),
  sessionStateChange:     sampled('session.state-change', SAMPLED_STATE),
  sessionPersisted:       sampled('session.persisted'),
  configChanged:          sampled('config.changed'),
  queueMutated:           debug('queue.mutated'),
  playerHostChanged:      info('player.host-changed'),
  playbackStarted:        info('playback.started'),
  playbackStalled:        warn('playback.stalled'),
  playbackStallAutoAdvanced: warn('playback.stall-auto-advanced'),
  playbackError:          error('playback.error'),
  playbackAdvanced:       info('playback.advanced'),
  playbackProblem:        warn('playback.problem'),
  playbackRecovered:      info('playback.recovered'),
  searchIssued:           debug('search.issued'),
  searchResultChunk:      debug('search.result-chunk'),
  searchCompleted:        info('search.completed'),
  searchModeEntered:      info('search.mode_entered'),
  searchModeExited:       info('search.mode_exited'),
  dispatchInitiated:      info('dispatch.initiated'),
  dispatchStep:           sampled('dispatch.step', { maxPerMinute: 30, aggregate: true }),
  dispatchSucceeded:      info('dispatch.succeeded'),
  dispatchFailed:         warn('dispatch.failed'),
  dispatchDeduplicated:   info('dispatch.deduplicated'),
  outcomeRecorded:        info('outcome.recorded'),
  outcomeResolved:        info('outcome.resolved'),
  outcomeCleared:         info('outcome.cleared'),
  outcomeRetried:         info('outcome.retried'),
  outcomeSentElsewhere:   info('outcome.sent-elsewhere'),
  outcomeDismissed:       debug('outcome.dismissed'),
  outcomeUndo:            info('outcome.undo'),
  outcomeStopped:         info('outcome.stopped'),
  outcomeSkipped:         info('outcome.skipped'),
  outcomeStopFailed:      warn('outcome.stop-failed'),
  outcomeUndoFailed:      warn('outcome.undo-failed'),
  destinationChanged:     info('dispatch.destination_changed'),
  aimRestored:            info('aim.restored'),
  aimActivity:            sampled('aim.activity', { maxPerMinute: 30, aggregate: true }),
  aimExpired:             info('aim.expired'),
  aimExemption:           info('aim.exemption'),
  castSheetOpened:        info('cast.sheet_opened'),
  peekEntered:            info('peek.entered'),
  peekExited:             info('peek.exited'),
  peekCommand:            debug('peek.command'),
  peekCommandAck:         sampled('peek.command-ack'),
  takeoverInitiated:      info('takeover.initiated'),
  takeoverSucceeded:      info('takeover.succeeded'),
  takeoverFailed:         warn('takeover.failed'),
  takeoverDrift:          warn('takeover.drift'),
  handoffInitiated:       info('handoff.initiated'),
  handoffSucceeded:       info('handoff.succeeded'),
  handoffFailed:          warn('handoff.failed'),
  wsConnected:            info('ws.connected'),
  wsDisconnected:         info('ws.disconnected'),
  wsReconnected:          info('ws.reconnected'),
  wsStale:                warn('ws.stale'),
  reconnectingShown:      info('ws.reconnecting-shown'),
  reconnectingCleared:    info('ws.reconnecting-cleared'),
  externalControlReceived: info('external-control.received'),
  externalControlRejected: warn('external-control.rejected'),
  urlCommandProcessed:    info('url-command.processed'),
  urlCommandIgnored:      debug('url-command.ignored'),
  navPushed:              debug('nav.pushed'),
  transportCommand:       sampled('transport.command', { maxPerMinute: 60, aggregate: true }),
  // Batch B — handle and controls (screen session controls, lock screen,
  // several-screen aim, moves between screens).
  naturalEndConsulted:    info('session-controls.natural-end'),
  sessionControlCommand:  info('session-controls.command'),
  sessionControlResult:   info('session-controls.result'),
  sessionControlFailed:   warn('session-controls.failed'),
  sleepTimerChanged:      info('session-controls.sleep-timer'),
  countdownChanged:       info('session-controls.countdown'),
  endOfQueueResult:       info('session-controls.end-of-queue'),
  mediaSessionBound:      info('media-session.bound'),
  mediaSessionUnavailable: info('media-session.unavailable'),
  mediaSessionAction:     info('media-session.action'),
  mediaSessionFailed:     warn('media-session.failed'),
  addToQueueOpened:       info('add-to-queue.opened'),
  addToQueueClosed:       info('add-to-queue.closed'),
  lineUpRequested:        info('line-up.requested'),
  lineUpFailed:           warn('line-up.failed'),
  aimDriftWarned:         info('aim.drift-warned'),
  screenMoveInitiated:    info('screen-move.initiated'),
  screenMoveSucceeded:    info('screen-move.succeeded'),
  screenMoveFailed:       warn('screen-move.failed'),
};

export default mediaLog;
