import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger, { configure } from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import MenuNavigationContext from '@/context/MenuNavigationContext.jsx';
import DayColumn from './components/DayColumn.jsx';
import DayReel from './components/DayReel.jsx';
import DayContextPanel from './components/DayContextPanel.jsx';
import PreFlightOverlay from './components/PreFlightOverlay.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import ControlLegend from './components/ControlLegend.jsx';
import ConfirmOverlay from './components/ConfirmOverlay.jsx';
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import { useChunkUploader } from './hooks/useChunkUploader.js';
import { deleteSession as deleteLocalSession, listSessions as listLocalSessions, getChunksForSession } from './hooks/chunkDb.js';
import { withTimeout, TIMEOUT } from './hooks/withTimeout.js';
import { modalReducer, initialModalState } from './state/modalReducer.js';
import { viewReducer, initialViewState } from './state/viewReducer.js';
import { resolveKey } from './state/keymap.js';
import './WeeklyReview.scss';

// Most-recent-8-day grid is 4 columns wide.
const GRID_COLS = 4;
// Two presses of the same horizontal direction within this window cross to the adjacent day.
const DOUBLE_EDGE_WINDOW_MS = 500;

export default function WeeklyReview({ dispatch, dismiss, clear }) {
  // Persist this review's logs to media/logs/weekly-review/*.jsonl. The session-file
  // transport only writes events whose context carries app + sessionLog. Set them on
  // global config SYNCHRONOUSLY on first render (not in an effect) so the lazy hook
  // loggers (recorder/uploader), which emit from effects registered below this point,
  // inherit the context before their first event. See audit
  // docs/_wip/audits/2026-06-07-weekly-review-session-logging-gap.md.
  const sessionLogConfiguredRef = useRef(false);
  if (!sessionLogConfiguredRef.current) {
    configure({ context: { app: 'weekly-review', sessionLog: true } });
    sessionLogConfiguredRef.current = true;
  }
  // This child carries sessionLog in its own context, so it emits the single
  // session-log.start that opens the session file (hooks/DayReel inherit from global
  // config and route to the same file without re-firing start).
  const logger = useMemo(
    () => getLogger().child({ app: 'weekly-review', component: 'weekly-review', sessionLog: true }),
    []
  );

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // eslint-disable-next-line no-unused-vars -- setUploading kept; Task 14 may revive or remove it
  const [uploading, setUploading] = useState(false);
  // Single reducer for all overlay state. See state/modalReducer.js.
  // modal.type ∈ { null, 'exitGate', 'resumeDraft', 'finalizeError', 'disconnect', 'preflightFailed' }
  // modal.focusIndex: button focus within the modal (0 ↔ 1)
  // modal.payload: per-modal data (e.g. resumeDraft descriptor, finalize error message, disconnect phase)
  const [modal, dispatchModal] = React.useReducer(modalReducer, initialModalState);
  // Two-level view state machine (grid ↔ reel). See state/viewReducer.js.
  const [view, dispatchView] = React.useReducer(viewReducer, initialViewState);

  const lastEdgeRef = useRef(null); // { dir, at } for double-tap cross-day

  // Derive everything the keymap needs about the focused media item.
  const mediaCtx = useMemo(() => {
    const days = data?.days || [];
    const day = days[view.dayIndex];
    const items = day?.photos || [];
    const itemCount = items.length;
    const cur = items[view.itemIndex];
    const currentType = !cur ? 'none' : (cur.type === 'video' ? 'video' : 'photo');
    const prevDayIndex = view.dayIndex - 1;
    const nextDayIndex = view.dayIndex + 1;
    const hasPrevDay = prevDayIndex >= 0;
    const hasNextDay = nextDayIndex < days.length;
    const prevDayLastIndex = hasPrevDay ? Math.max(0, (days[prevDayIndex]?.photos?.length || 1) - 1) : 0;
    return {
      itemCount, currentType,
      atFirst: view.itemIndex <= 0,
      atLast: view.itemIndex >= itemCount - 1,
      hasPrevDay, hasNextDay, prevDayIndex, nextDayIndex, prevDayLastIndex,
    };
  }, [data, view.dayIndex, view.itemIndex, view.level]);

  const autoStartRef = useRef(false);
  // Proactive Shield AudioBridge heal must complete (or time out) before the
  // recorder first probes the mic — otherwise the recorder silently falls back
  // to getUserMedia and records silence. bridgeReady gates both start paths.
  const [bridgeReady, setBridgeReady] = useState(false);
  const bridgeHealRef = useRef(false);
  const menuNav = React.useContext(MenuNavigationContext);

  // Durable recording pipeline: stable sessionId per mount+week.
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) {
    sessionIdRef.current = (crypto?.randomUUID?.() || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  const weekForUploader = data?.week || '0000-00-00';
  const uploader = useChunkUploader({ sessionId: sessionIdRef.current, week: weekForUploader });
  const { enqueue: uploaderEnqueue, flushNow: uploaderFlushNow, beaconFlush: uploaderBeaconFlush, status: uploaderStatus, pendingCount: uploaderPendingCount, pendingCountRef: uploaderPendingCountRef, lastAckedAt: uploaderLastAckedAt } = uploader;

  const handleChunk = useCallback(async ({ seq, blob }) => {
    await uploaderEnqueue({ seq, blob });
  }, [uploaderEnqueue]);

  const {
    isRecording, duration: recordingDuration, micLevelRef, silenceWarning,
    error: recorderError, startRecording, stopRecording,
    firstAudibleFrameSeen, disconnected, reconnect,
  } = useAudioRecorder({ onChunk: handleChunk });

  // Audio status is NON-BLOCKING: the review is always usable. preflightStatus is
  // only 'acquiring' (mic warming up) or 'ok' (an audible frame was seen). If the
  // mic never produces audio, `audioUnavailable` drives a non-blocking notice that
  // tells the user to record their review separately — it never traps them.
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const preflightStatus = firstAudibleFrameSeen ? 'ok' : 'acquiring';

  // Ref so handleKeyDown reads the latest preflightStatus without stale-closure lag.
  // Assigning during render (rather than useEffect) is intentional: a useEffect-based
  // mirror runs post-paint, which would WIDEN the window where ref.current lags
  // behind the rendered DOM. Render-body assignment commits before any DOM event
  // can fire on the new tree. The soft preflight gate during 'acquiring' provides
  // defense-in-depth if any timing edge-case slips through.
  const preflightStatusRef = useRef(preflightStatus);
  preflightStatusRef.current = preflightStatus;

  // Task 9 callbacks — declared after useAudioRecorder so stopRecording is in scope.
  // Some are stubs; Tasks 10–12 will wire them up fully.
  const onExitWidget = useCallback(() => {
    // Three callers depending on launch context:
    //   - screen-framework widget: dispatch('escape')
    //   - widget dismiss helper: dismiss()
    //   - standalone /app/weekly-review (AppContainer): clear()
    if (typeof dispatch === 'function') dispatch('escape');
    else if (typeof dismiss === 'function') dismiss();
    else if (typeof clear === 'function') clear();
  }, [dispatch, dismiss, clear]);

  const onSaveAndExit = useCallback(async () => {
    // Save & close: stop recorder, flush any pending chunks, finalize on
    // server, then exit. Show the disconnect/finalizing modal as progress
    // feedback (reused — same shape). Always exit at the end, even on
    // finalize error, so the user is never trapped inside the widget.
    stopRecording();
    dispatchModal({ type: 'OPEN', modal: 'disconnect', payload: { phase: 'finalizing' } });
    try {
      uploaderFlushNow();
      if (sessionIdRef.current && data?.week) {
        const res = await withTimeout(DaylightAPI('/api/v1/weekly-review/recording/finalize', {
          sessionId: sessionIdRef.current, week: data.week, duration: recordingDuration,
        }, 'POST'), 8000);
        // Only drop the local draft if the server actually confirmed. On timeout
        // keep it so mount-time recovery can finalize later.
        if (res !== TIMEOUT) await deleteLocalSession(sessionIdRef.current).catch(() => {});
        else logger.warn('save-and-exit.finalize-timeout');
      }
    } catch (err) {
      logger.error('save-and-exit.finalize-failed', { error: err.message });
    } finally {
      dispatchModal({ type: 'CLOSE' });
      onExitWidget();
    }
  }, [stopRecording, uploaderFlushNow, data?.week, recordingDuration, onExitWidget]);

  // Ref so the pop-guard (registered once) always calls the current onSaveAndExit.
  const onSaveAndExitRef = useRef(onSaveAndExit);
  onSaveAndExitRef.current = onSaveAndExit;

  const onPreflightRetry = useCallback(() => {
    dispatchModal({ type: 'CLOSE' });
    autoStartRef.current = false;
    stopRecording();
    setTimeout(() => {
      // Don't re-probe the mic until the proactive heal has settled.
      if (!bridgeReady) return;
      autoStartRef.current = true;
      startRecording();
    }, 100);
  }, [stopRecording, startRecording, bridgeReady]);
  useEffect(() => {
    logger.info('mount');
    return () => {
      logger.info('unmount');
      // Stop routing global logs to the weekly-review session file once we leave.
      configure({ context: { sessionLog: false } });
    };
  }, []);

  // Proactive AudioBridge heal: relaunch the Shield companion from FKB's
  // foreground BEFORE the recorder probes the mic. Capped at 6s so a slow/dead
  // Shield never blocks the review — bridgeReady flips true either way.
  useEffect(() => {
    if (bridgeHealRef.current) return;
    bridgeHealRef.current = true;
    logger.info('bridge-heal.requested');
    Promise.race([
      DaylightAPI('/api/v1/device/audio-bridge/heal', { force: false }, 'POST').catch(() => {}),
      new Promise((r) => setTimeout(r, 6000)),
    ]).finally(() => {
      logger.info('bridge-heal.ready');
      setBridgeReady(true);
    });
  }, []);

  useEffect(() => {
    logger.debug('state.uploading', { uploading });
  }, [uploading]);

  // Track when recording starts
  useEffect(() => {
    logger.info('state.is-recording', { isRecording });
  }, [isRecording]);

  useEffect(() => {
    if (recorderError) {
      logger.error('state.recorder-error', { error: recorderError });
      // Surface the non-blocking "record separately" notice; never block the UI.
      setAudioUnavailable(true);
    }
  }, [recorderError]);

  useEffect(() => {
    logger.info('bootstrap.fetching');
    const fetchBootstrap = async () => {
      try {
        const result = await DaylightAPI('/api/v1/weekly-review/bootstrap');
        setData(result);
        dispatchView({ type: 'SELECT_DAY', dayIndex: Math.max(0, (result.days?.length || 1) - 1) });
        const totalPhotos = result.days?.reduce((s, d) => s + (d.photoCount || 0), 0) || 0;
        const totalEvents = result.days?.reduce((s, d) => s + (d.calendar?.length || 0), 0) || 0;
        const daysWithPhotos = result.days?.filter(d => d.photoCount > 0).length || 0;
        logger.info('bootstrap.loaded', {
          week: result.week,
          dayCount: result.days?.length,
          totalPhotos,
          totalEvents,
          daysWithPhotos,
          hasExistingRecording: result.recording?.exists,
        });
      } catch (err) {
        logger.error('bootstrap.failed', { error: err.message });
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchBootstrap();
  }, []);

  useEffect(() => {
    if (!data || autoStartRef.current) return;
    // Wait for the proactive AudioBridge heal before probing the mic. The effect
    // re-runs once bridgeReady flips true.
    if (!bridgeReady) return;
    autoStartRef.current = true;
    logger.info('recording.auto-start');
    startRecording();
  }, [data, startRecording, bridgeReady]);

  // Ref so the audio-recovery and pop-guard effects can read modal.type without
  // taking modal as a dep (which would tear down/restart inner timers on every
  // modal change). Render-body assignment (rather than useEffect) is intentional
  // for the same reason as preflightStatusRef: a useEffect-based mirror runs
  // post-paint, widening the staleness window.
  const modalTypeRef = useRef(modal.type);
  modalTypeRef.current = modal.type;

  useEffect(() => {
    if (firstAudibleFrameSeen) {
      // Audio is working — clear any "record separately" notice.
      setAudioUnavailable(false);
      return;
    }
    if (!isRecording) return;
    // Grace period: if no audible frame within 10s of recording, surface a
    // NON-BLOCKING notice (record separately). This never opens a modal — the
    // user is never locked out of the review. The effect re-runs (and clears the
    // timer) the instant an audible frame is seen, so this only fires if audio
    // genuinely never arrived.
    const timer = setTimeout(() => {
      logger.warn('recording.preflight-timeout');
      setAudioUnavailable(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, [firstAudibleFrameSeen, isRecording]);

  // Task 12: Disconnect detection — attempt bounded reconnect, then force-finalize and exit.
  const disconnectFiredRef = useRef(false);
  useEffect(() => {
    if (!disconnected) {
      disconnectFiredRef.current = false;
      return;
    }
    if (disconnectFiredRef.current) return;
    disconnectFiredRef.current = true;
    (async () => {
      logger.warn('disconnect.detected');
      dispatchModal({ type: 'OPEN', modal: 'disconnect', payload: { phase: 'reconnecting' } });
      const ok = await reconnect();
      if (ok) {
        logger.info('disconnect.recovered');
        dispatchModal({ type: 'CLOSE' });
        return;
      }
      // Reconnect failed — the Shield companion may have lost the mic. Force a
      // heal (relaunch from FKB foreground), give it a moment, then retry once
      // more before falling through to finalize-and-exit.
      logger.warn('bridge-heal.reactive');
      await DaylightAPI('/api/v1/device/audio-bridge/heal', { force: true }, 'POST').catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
      const ok2 = await reconnect();
      if (ok2) {
        logger.info('disconnect.recovered');
        dispatchModal({ type: 'CLOSE' });
        return;
      }
      logger.warn('disconnect.reconnect-failed-finalizing');
      dispatchModal({ type: 'OPEN', modal: 'disconnect', payload: { phase: 'finalizing' } });
      try {
        uploaderFlushNow();
        const res = await withTimeout(DaylightAPI('/api/v1/weekly-review/recording/finalize', {
          sessionId: sessionIdRef.current, week: data?.week, duration: recordingDuration,
        }, 'POST'), 8000);
        if (res !== TIMEOUT) await deleteLocalSession(sessionIdRef.current).catch(() => {});
        else logger.warn('disconnect.finalize-timeout');
        dispatchModal({ type: 'CLOSE' });
        onExitWidget();
      } catch (err) {
        logger.error('disconnect.finalize-failed', { error: err.message });
        dispatchModal({ type: 'CLOSE' });
        dispatchModal({ type: 'OPEN', modal: 'finalizeError', payload: err.message });
      }
    })();
  }, [disconnected, reconnect, uploaderFlushNow, data?.week, recordingDuration, onExitWidget]);

  // Mount-time draft recovery: check server and local IndexedDB for unfinalized sessions.
  useEffect(() => {
    if (!data?.week) return;
    let cancelled = false;
    (async () => {
      try {
        const serverResp = await DaylightAPI(`/api/v1/weekly-review/recording/drafts?week=${data.week}`);
        const serverDraft = (serverResp.drafts || [])
          .filter(d => d.sessionId !== sessionIdRef.current)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
        if (serverDraft && !cancelled) {
          logger.info('recording.resume-candidate.server', serverDraft);
          dispatchModal({
            type: 'OPEN', modal: 'resumeDraft',
            payload: { sessionId: serverDraft.sessionId, source: 'server', totalBytes: serverDraft.totalBytes, lastSavedAt: serverDraft.updatedAt },
          });
          return;
        }
        const localSessions = await listLocalSessions();
        const localDraft = localSessions
          .filter(s => s.week === data.week && s.sessionId !== sessionIdRef.current && s.unuploadedCount > 0)
          .sort((a, b) => b.lastSavedAt - a.lastSavedAt)[0];
        if (localDraft && !cancelled) {
          logger.info('recording.resume-candidate.local', localDraft);
          dispatchModal({
            type: 'OPEN', modal: 'resumeDraft',
            payload: { sessionId: localDraft.sessionId, source: 'local', totalBytes: null, lastSavedAt: new Date(localDraft.lastSavedAt).toISOString(), chunkCount: localDraft.chunkCount },
          });
        }
      } catch (err) {
        logger.warn('recording.resume-check-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [data?.week]);

  const finalizePriorDraft = useCallback(async () => {
    const draft = modal.type === 'resumeDraft' ? modal.payload : null;
    if (!draft?.sessionId || !data?.week) return;
    // Close the modal immediately so the user gets feedback on Enter and the
    // grid behind it becomes usable — finalize runs in the background. If it
    // fails, log it; the modal does NOT reopen (user can re-trigger from the
    // recording bar if needed).
    dispatchModal({ type: 'CLOSE' });
    try {
      logger.info('recording.resume.finalize', { sessionId: draft.sessionId, source: draft.source });
      if (draft.source === 'local') {
        const rows = await getChunksForSession(draft.sessionId);
        for (const row of rows) {
          if (row.uploaded) continue;
          const buf = await row.blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
          const chunkBase64 = btoa(bin);
          // Retry with backoff: 500ms, 1s, 2s
          let lastErr = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await DaylightAPI('/api/v1/weekly-review/recording/chunk', { sessionId: draft.sessionId, seq: row.seq, week: data.week, chunkBase64 }, 'POST');
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              logger.warn('recording.resume.chunk-retry', { seq: row.seq, attempt, error: err.message });
              if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (1 << attempt)));
            }
          }
          if (lastErr) throw new Error(`chunk ${row.seq} failed after 3 retries: ${lastErr.message}`);
        }
      }
      let estimatedDuration = 0;
      if (draft.source === 'local') {
        // chunkCount * 5 seconds per chunk
        estimatedDuration = (draft.chunkCount || 0) * 5;
      } else if (draft.source === 'server') {
        // Server drafts: estimate from totalBytes and typical opus bitrate ~24kbps (3000 bytes/sec)
        estimatedDuration = Math.round((draft.totalBytes || 0) / 3000);
      }
      await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: draft.sessionId, week: data.week, duration: estimatedDuration,
      }, 'POST');
      await deleteLocalSession(draft.sessionId);
      const fresh = await DaylightAPI('/api/v1/weekly-review/bootstrap');
      setData(fresh);
    } catch (err) {
      // 404 = draft already finalized/gone elsewhere — not really an error.
      const is404 = /HTTP 404/.test(err.message || '');
      if (is404) logger.info('recording.resume.finalize-noop', { reason: 'draft-already-gone' });
      else logger.error('recording.resume.finalize-failed', { error: err.message });
    }
  }, [modal, data?.week]);

  // Pagehide/beforeunload beacon flush
  useEffect(() => {
    const handlePageHide = () => {
      if (isRecording || uploaderPendingCount > 0) {
        logger.info('recording.pagehide-beacon', { pending: uploaderPendingCount, isRecording });
        uploaderBeaconFlush();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
    };
  }, [isRecording, uploaderPendingCount, uploaderBeaconFlush]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!data?.days) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();

      const result = resolveKey({
        view,
        modalType: modal.type,
        modalFocus: modal.focusIndex,
        preflight: preflightStatusRef.current,
        key: e.key,
        now: Date.now(),
        cols: GRID_COLS,
        totalDays: data.days.length,
        media: mediaCtx,
        lastEdge: lastEdgeRef.current,
        doubleWindowMs: DOUBLE_EDGE_WINDOW_MS,
      });

      lastEdgeRef.current = result.edge; // null clears it; {dir,at} arms the next tap
      result.view.forEach(a => dispatchView(a));
      result.modal.forEach(a => dispatchModal(a));
      for (const intent of result.intents) {
        if (intent === 'saveAndExit') onSaveAndExit();
        else if (intent === 'exitWidget' || intent === 'exitNoSave') onExitWidget();
        else if (intent === 'retryMic') onPreflightRetry();
        else if (intent === 'finalizeDraft') finalizePriorDraft();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [data, view, modal, mediaCtx,
      finalizePriorDraft, onExitWidget, onSaveAndExit, onPreflightRetry]);

  // Pop guard: prevent MenuNavigationContext from popping the app while recording or uploading.
  // Handles remote Back button (FKB/Shield popstate) and any other pop() caller.
  // modalTypeRef is declared above near the preflight effect — reuse it here.
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const viewLevelRef = useRef(view.level);
  viewLevelRef.current = view.level;

  useEffect(() => {
    if (!menuNav?.setPopGuard) return;
    if (!isRecording) {
      menuNav.clearPopGuard();
      return;
    }

    menuNav.setPopGuard(() => {
      logger.info('nav.pop-guard', { isRecording: isRecordingRef.current, viewLevel: viewLevelRef.current, modalType: modalTypeRef.current });
      if (modalTypeRef.current === 'exitGate') { onSaveAndExitRef.current(); return false; }
      if (viewLevelRef.current === 'reel') { dispatchView({ type: 'CLIMB' }); return false; }
      dispatchModal({ type: 'OPEN', modal: 'exitGate', focusIndex: 1 });
      return false;
    });

    return () => menuNav.clearPopGuard();
  }, [isRecording, menuNav]);

  const weekLabel = useMemo(() => {
    if (!data?.days?.length) return '';
    const first = data.days[0];
    const last = data.days[data.days.length - 1];
    const fmtDate = (d) => {
      const dt = new Date(`${d}T12:00:00Z`);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return `Week of ${fmtDate(first.date)} – ${fmtDate(last.date)}`;
  }, [data]);

  if (loading) {
    return <div className="weekly-review weekly-review--loading">Loading...</div>;
  }

  if (error) {
    return <div className="weekly-review weekly-review--error">Failed to load: {error}</div>;
  }

  return (
    <div className="weekly-review">
      {/* Resume-draft overlay */}
      {modal.type === 'resumeDraft' && !isRecording && (
        <ConfirmOverlay labelId="wr-resume-label">
          <div className="confirm-message" id="wr-resume-label">
            A previous recording was not finalized.<br/>
            <small>{modal.payload?.source === 'server' ? `Server draft · ${Math.round((modal.payload?.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${modal.payload?.chunkCount || 0} chunks`}</small>
          </div>
          <div className="confirm-actions">
            <button className="confirm-btn confirm-btn--save focused" onClick={finalizePriorDraft}>Finalize Previous</button>
            <button className="confirm-btn confirm-btn--continue" onClick={() => dispatchModal({ type: 'CLOSE' })}>Not now</button>
          </div>
        </ConfirmOverlay>
      )}

      {/* Two-level surface: reel over grid */}
      {view.level === 'reel' && data?.days?.[view.dayIndex] ? (() => {
        const day = data.days[view.dayIndex];
        const items = day.photos || [];
        const safeIdx = Math.min(view.itemIndex, Math.max(0, items.length - 1));
        const dt = new Date(`${day.date}T12:00:00Z`);
        const dayLabel = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        return (
          <>
            <DayReel
              item={items[safeIdx] || null}
              day={day}
              index={safeIdx}
              total={items.length}
              dayLabel={dayLabel}
              playing={view.playing}
              muted={view.muted}
              paused={view.contextOpen}
              onEnded={() => dispatchView({ type: 'STOP_VIDEO' })}
            />
            <DayContextPanel day={day} open={view.contextOpen} />
          </>
        );
      })() : (
        <div className="weekly-review-grid">
          {data.days.map((day, realIndex) => (
            <DayColumn
              key={day.date}
              day={day}
              isFocused={realIndex === view.dayIndex}
              onClick={() => {
                dispatchView({ type: 'SELECT_DAY', dayIndex: realIndex });
                dispatchView({ type: 'OPEN_DAY' });
              }}
            />
          ))}
        </div>
      )}

      {/* Finalize-error dialog */}
      {modal.type === 'finalizeError' && !isRecording && (
        <ConfirmOverlay labelId="wr-error-label">
          <div className="confirm-message" id="wr-error-label">
            Save failed: {modal.payload}<br/>
            <small>Your recording is safe — stored locally and on the server.</small>
          </div>
          <div className="confirm-actions">
            <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => dispatchModal({ type: 'CLOSE' })}>Dismiss</button>
            <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={onExitWidget}>Exit (save later)</button>
          </div>
        </ConfirmOverlay>
      )}

      {/* Exit gate */}
      {modal.type === 'exitGate' && (
        <ConfirmOverlay labelId="wr-exit-label">
          <div className="confirm-message" id="wr-exit-label">Done with your weekly review?</div>
          <div className="confirm-actions">
            <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => dispatchModal({ type: 'CLOSE' })}>Keep going</button>
            <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={onSaveAndExit}>✓ Save &amp; Close</button>
          </div>
          <div className="confirm-hint">Press <strong>OK</strong> to save &amp; close · <strong>Back</strong> again also saves &amp; closes</div>
        </ConfirmOverlay>
      )}

      {/* Disconnect modal */}
      {modal.type === 'disconnect' && (
        <ConfirmOverlay labelId="wr-disc-label" ariaLive="polite">
          <div className="confirm-message" id="wr-disc-label">
            {modal.payload?.phase === 'reconnecting' && (<>Microphone dropped — reconnecting…<br/><small>Please hold tight.</small></>)}
            {modal.payload?.phase === 'finalizing' && (<>Microphone disconnected.<br/><small>Saving your recording…</small></>)}
          </div>
        </ConfirmOverlay>
      )}

      <PreFlightOverlay
        status={preflightStatus}
        unavailable={audioUnavailable}
      />

      <ControlLegend
        level={view.level}
        contextOpen={view.contextOpen}
        mediaType={mediaCtx.currentType}
        playing={view.playing}
        modalType={modal.type}
      />

      <RecordingBar
        weekLabel={weekLabel}
        isRecording={isRecording}
        duration={recordingDuration}
        micLevelRef={micLevelRef}
        silenceWarning={silenceWarning}
        uploading={uploading}
        micConnected={isRecording && !disconnected}
        existingRecording={data.recording}
        error={recorderError}
        syncStatus={uploaderStatus}
        pendingCount={uploaderPendingCount}
        lastAckedAt={uploaderLastAckedAt}
      />
    </div>
  );
}
