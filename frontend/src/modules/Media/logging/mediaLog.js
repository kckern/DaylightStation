// frontend/src/modules/Media/logging/mediaLog.js
import { getChildLogger } from '../../../lib/logging/singleton.js';

// `sessionLog` is what makes these events DURABLE. The backend session-file
// transport gates on `context.app && context.sessionLog`
// (0_system/logging/transports/sessionFile.mjs) — without the flag every event
// below is stdout-only and dies with the container. On 2026-08-16 the durable
// record of a real incident held 13 events, all of them from ContentCombobox
// (which sets its own sessionLog); the entire §10.1 taxonomy — playback,
// stalls, dispatch, errors — was missing, and the diagnosis survived only
// because `docker logs` happened not to have rolled.
let _logger;
function base() {
  if (!_logger) _logger = getChildLogger({ app: 'media', sessionLog: true });
  return _logger;
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
  searchIssued:           debug('search.issued'),
  searchResultChunk:      debug('search.result-chunk'),
  searchCompleted:        info('search.completed'),
  dispatchInitiated:      info('dispatch.initiated'),
  dispatchStep:           sampled('dispatch.step', { maxPerMinute: 30, aggregate: true }),
  dispatchSucceeded:      info('dispatch.succeeded'),
  dispatchFailed:         warn('dispatch.failed'),
  dispatchDeduplicated:   info('dispatch.deduplicated'),
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
  externalControlReceived: info('external-control.received'),
  externalControlRejected: warn('external-control.rejected'),
  urlCommandProcessed:    info('url-command.processed'),
  urlCommandIgnored:      debug('url-command.ignored'),
  navPushed:              debug('nav.pushed'),
  transportCommand:       sampled('transport.command', { maxPerMinute: 60, aggregate: true }),
};

export default mediaLog;
