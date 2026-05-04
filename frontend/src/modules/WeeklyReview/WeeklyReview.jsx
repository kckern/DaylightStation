import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import MenuNavigationContext from '@/context/MenuNavigationContext.jsx';
import DayColumn from './components/DayColumn.jsx';
import DayDetail from './components/DayDetail.jsx';
import FullscreenImage from './components/FullscreenImage.jsx';
import PreFlightOverlay from './components/PreFlightOverlay.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import { useChunkUploader } from './hooks/useChunkUploader.js';
import { deleteSession as deleteLocalSession, listSessions as listLocalSessions, getChunksForSession } from './hooks/chunkDb.js';
import { modalReducer, initialModalState } from './state/modalReducer.js';
import './WeeklyReview.scss';

const logger = getLogger().child({ component: 'weekly-review' });

export default function WeeklyReview({ dispatch, dismiss }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // eslint-disable-next-line no-unused-vars -- setUploading kept; Task 14 may revive or remove it
  const [uploading, setUploading] = useState(false);
  // Task 5: single reducer replaces 8 individual overlay flags. See state/modalReducer.js.
  // modal.type ∈ { null, 'stopConfirm', 'resumeDraft', 'finalizeError', 'disconnect', 'preflightFailed' }
  // modal.focusIndex: button focus within the modal (0 ↔ 1)
  // modal.payload: per-modal data (e.g. resumeDraft descriptor, finalize error message, disconnect phase)
  const [modal, dispatchModal] = React.useReducer(modalReducer, initialModalState);
  // Task 8: viewLevel state machine — replaces selectedDay/focusedDay/focusRow/barFocus
  const [viewLevel, setViewLevel] = useState('toc');           // 'toc' | 'day' | 'fullscreen'
  const [dayIndex, setDayIndex] = useState(0);                 // always valid once data loads
  const [imageIndex, setImageIndex] = useState(0);             // valid when viewLevel === 'fullscreen'

  // Task 9: focus row state (preflight + disconnect modal moved to modalReducer in Task 5)
  const [focusRow, setFocusRow] = useState('main');            // 'main' | 'bar'

  const autoStartRef = useRef(false);
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
    isRecording, duration: recordingDuration, micLevel, silenceWarning,
    error: recorderError, startRecording, stopRecording,
    firstAudibleFrameSeen, disconnected, reconnect,
  } = useAudioRecorder({ onChunk: handleChunk });

  const preflightStatus = modal.type === 'preflightFailed'
    ? 'failed'
    : (firstAudibleFrameSeen ? 'ok' : 'acquiring');

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
    if (typeof dispatch === 'function') dispatch('escape');
    else if (typeof dismiss === 'function') dismiss();
  }, [dispatch, dismiss]);

  const onSaveAndExit = useCallback(() => {
    // Stops the recorder; the existing onstop chain finalizes.
    // Task 10 will wire up auto-finalize on stop.
    stopRecording();
  }, [stopRecording]);

  const onPreflightRetry = useCallback(() => {
    dispatchModal({ type: 'CLOSE' });
    autoStartRef.current = false;
    stopRecording();
    setTimeout(() => { autoStartRef.current = true; startRecording(); }, 100);
  }, [stopRecording, startRecording]);
  const onPreflightExit  = useCallback(() => onExitWidget(), [onExitWidget]);

  const onBackPressed = useCallback(() => {
    // Climb hierarchy at L2/L3; save-confirm modal at L1 TOC.
    if (focusRow === 'bar') { setFocusRow('main'); return; }
    if (viewLevel === 'fullscreen') { setViewLevel('day'); return; }
    if (viewLevel === 'day')        { setViewLevel('toc'); return; }
    dispatchModal({ type: 'OPEN', modal: 'stopConfirm' });
  }, [viewLevel, focusRow]);

  useEffect(() => {
    logger.info('mount');
    return () => logger.info('unmount');
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
    }
  }, [recorderError]);

  useEffect(() => {
    logger.info('bootstrap.fetching');
    const fetchBootstrap = async () => {
      try {
        const result = await DaylightAPI('/api/v1/weekly-review/bootstrap');
        setData(result);
        setDayIndex(Math.max(0, (result.days?.length || 1) - 1));
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
    autoStartRef.current = true;
    logger.info('recording.auto-start');
    startRecording();
  }, [data, startRecording]);

  // Ref so the audio-recovery and pop-guard effects can read modal.type without
  // taking modal as a dep (which would tear down/restart inner timers on every
  // modal change). Render-body assignment (rather than useEffect) is intentional
  // for the same reason as preflightStatusRef: a useEffect-based mirror runs
  // post-paint, widening the staleness window.
  const modalTypeRef = useRef(modal.type);
  modalTypeRef.current = modal.type;

  useEffect(() => {
    if (firstAudibleFrameSeen) {
      // Audio recovered — clear the preflight-failed modal if it's the one open.
      // Don't blindly CLOSE: other modals (stopConfirm, finalizeError) must persist.
      if (modalTypeRef.current === 'preflightFailed') {
        dispatchModal({ type: 'CLOSE' });
      }
      return;
    }
    if (!isRecording) return;
    const timer = setTimeout(() => {
      if (!firstAudibleFrameSeen) {
        logger.warn('recording.preflight-timeout');
        dispatchModal({ type: 'OPEN', modal: 'preflightFailed' });
      }
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
      logger.warn('disconnect.reconnect-failed-finalizing');
      dispatchModal({ type: 'OPEN', modal: 'disconnect', payload: { phase: 'finalizing' } });
      try {
        uploaderFlushNow();
        await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
          sessionId: sessionIdRef.current, week: data?.week, duration: recordingDuration,
        }, 'POST');
        await deleteLocalSession(sessionIdRef.current).catch(() => {});
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
      dispatchModal({ type: 'CLOSE' });
      const fresh = await DaylightAPI('/api/v1/weekly-review/bootstrap');
      setData(fresh);
    } catch (err) {
      logger.error('recording.resume.finalize-failed', { error: err.message });
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

  // 4-level keyboard navigation hierarchy
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!data?.days) return;
      const total = data.days.length;
      const isEnter = e.key === 'Enter' || e.key === ' ';
      const isBack  = e.key === 'Escape' || e.key === 'Backspace';

      // ---- Overlay-specific handling. These modals override "Enter = upload" ----

      // Preflight 'acquiring' gate. The overlay is visible but not a hard block:
      // Esc/Backspace exits the widget; other keys (arrows, Enter) fall through to
      // the main hierarchy so the user can pre-navigate while the mic warms up.
      // Use ref to avoid stale-closure lag on rapid key presses right after preflight clears.
      const currentPreflightStatus = preflightStatusRef.current;
      if (currentPreflightStatus === 'acquiring' && isBack) {
        e.preventDefault();
        onExitWidget();
        return;
      }

      // Modal handling: any open modal (preflightFailed, disconnect, stopConfirm, finalizeError,
      // resumeDraft) swallows main-hierarchy keys. Per-modal Enter/Back semantics differ slightly.
      if (modal.type) {
        if (modal.type === 'disconnect') {
          // Informational while reconnecting/finalizing — swallow all keys.
          e.preventDefault();
          return;
        }
        if (isBack) {
          e.preventDefault();
          if (modal.type === 'resumeDraft') return;            // must explicitly Finalize
          if (modal.type === 'preflightFailed') { onExitWidget(); return; }
          dispatchModal({ type: 'CLOSE' });
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (modal.type !== 'resumeDraft') dispatchModal({ type: 'TOGGLE_FOCUS' });
          return;
        }
        if (isEnter) {
          e.preventDefault();
          if (modal.type === 'stopConfirm') {
            if (modal.focusIndex === 0) {
              dispatchModal({ type: 'CLOSE' });
            } else {
              dispatchModal({ type: 'CLOSE' });
              onSaveAndExit();
            }
            return;
          }
          if (modal.type === 'finalizeError') {
            // Task 4 polish: both buttons just close; "Exit (save later)" also exits the widget.
            dispatchModal({ type: 'CLOSE' });
            if (modal.focusIndex === 1) onExitWidget();
            return;
          }
          if (modal.type === 'preflightFailed') {
            if (modal.focusIndex === 0) onPreflightRetry();
            else onPreflightExit();
            return;
          }
          if (modal.type === 'resumeDraft') {
            finalizePriorDraft();
            return;
          }
        }
        return;
      }

      // ---- Bottom recording bar focus ----
      // focusRow === 'bar' means the user has tabbed down onto the bar. Enter activates Save.
      if (focusRow === 'bar') {
        e.preventDefault();
        if (isEnter) { onSaveAndExit(); return; }
        if (e.key === 'ArrowUp')   { setFocusRow('main'); return; }
        if (e.key === 'ArrowDown') { onExitWidget(); return; }
        if (isBack) { setFocusRow('main'); return; }
        return;
      }

      // ---- Main hierarchy: Enter = open focused day (TOC) or fullscreen (day), Back = climb ----
      if (isEnter) {
        if (viewLevel === 'toc') {
          e.preventDefault();
          e.stopPropagation();
          setViewLevel('day');
          return;
        }
        if (viewLevel === 'day') {
          // Enter at day view: open fullscreen if photos exist; otherwise no-op.
          const photos = data.days[dayIndex]?.photos || [];
          if (photos.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            setImageIndex(0);
            setViewLevel('fullscreen');
          }
          return;
        }
        // Fullscreen: Enter is a no-op (use Esc to back out, arrows to navigate).
        return;
      }

      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        onBackPressed();
        return;
      }

      if (viewLevel === 'fullscreen') {
        const photos = data.days[dayIndex]?.photos || [];
        if (photos.length === 0) {
          // No images — drop straight to day view
          setViewLevel('day');
          return;
        }
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            setImageIndex(prev => (prev + 1) % photos.length);
            return;
          case 'ArrowDown':
            e.preventDefault();
            setImageIndex(prev => (prev - 1 + photos.length) % photos.length);
            return;
          case 'ArrowLeft':
            e.preventDefault();
            if (dayIndex > 0) {
              setDayIndex(dayIndex - 1);
              setImageIndex(0);
              setViewLevel('day');
            }
            return;
          case 'ArrowRight':
            e.preventDefault();
            if (dayIndex < total - 1) {
              setDayIndex(dayIndex + 1);
              setImageIndex(0);
              setViewLevel('day');
            }
            return;
          default: return;
        }
      }

      if (viewLevel === 'day') {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setViewLevel('toc');
            return;
          case 'ArrowUp':
            e.preventDefault();
            if ((data.days[dayIndex]?.photos?.length || 0) > 0) {
              setImageIndex(0);
              setViewLevel('fullscreen');
            }
            return;
          case 'ArrowLeft':
            e.preventDefault();
            if (dayIndex > 0) setDayIndex(dayIndex - 1);
            return;
          case 'ArrowRight':
            e.preventDefault();
            if (dayIndex < total - 1) setDayIndex(dayIndex + 1);
            return;
          default: return;
        }
      }

      // viewLevel === 'toc'
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onExitWidget();
          return;
        case 'ArrowDown':
          e.preventDefault();
          // First Down at TOC focuses the recording bar; only the next Down exits.
          // This keeps the bar reachable from the keyboard.
          setFocusRow('bar');
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (dayIndex > 0) {
            setDayIndex(dayIndex - 1);
            setViewLevel('day');
          }
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (dayIndex < total - 1) {
            setDayIndex(dayIndex + 1);
            setViewLevel('day');
          }
          return;
        default: return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [data, viewLevel, dayIndex, imageIndex, focusRow, modal,
      finalizePriorDraft, onExitWidget, onSaveAndExit,
      onPreflightRetry, onPreflightExit, onBackPressed]);

  // Pop guard: prevent MenuNavigationContext from popping the app while recording or uploading.
  // Handles remote Back button (FKB/Shield popstate) and any other pop() caller.
  // modalTypeRef is declared above near the preflight effect — reuse it here.
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const viewLevelRef = useRef(viewLevel);
  viewLevelRef.current = viewLevel;

  useEffect(() => {
    if (!menuNav?.setPopGuard) return;
    if (!isRecording) {
      menuNav.clearPopGuard();
      return;
    }

    menuNav.setPopGuard(() => {
      logger.info('nav.pop-guard', {
        isRecording: isRecordingRef.current,
        viewLevel: viewLevelRef.current,
        modalType: modalTypeRef.current,
      });

      if (modalTypeRef.current === 'stopConfirm') { dispatchModal({ type: 'CLOSE' }); return false; }
      if (viewLevelRef.current === 'fullscreen') { setViewLevel('day'); return false; }
      if (viewLevelRef.current === 'day')        { setViewLevel('toc'); return false; }
      dispatchModal({ type: 'OPEN', modal: 'stopConfirm' });
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
      {/* Resume-draft overlay — shown after bootstrap if an unfinalized draft exists */}
      {modal.type === 'resumeDraft' && !isRecording && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              A previous recording was not finalized.<br/>
              <small>{modal.payload?.source === 'server' ? `Server draft · ${Math.round((modal.payload?.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${modal.payload?.chunkCount || 0} chunks`}</small>
            </div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn--save focused" onClick={finalizePriorDraft}>Finalize Previous</button>
            </div>
          </div>
        </div>
      )}

      {/* Task 8: viewLevel-driven render — fullscreen > day > toc */}
      {viewLevel === 'fullscreen' && data?.days?.[dayIndex] && (() => {
        const photos = data.days[dayIndex].photos || [];
        const safeIdx = Math.min(imageIndex, Math.max(0, photos.length - 1));
        const dt = new Date(`${data.days[dayIndex].date}T12:00:00Z`);
        const dayLabel = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        return <FullscreenImage photo={photos[safeIdx]} index={safeIdx} total={photos.length} dayLabel={dayLabel} />;
      })()}

      {viewLevel === 'day' && data?.days?.[dayIndex] && (
        <DayDetail
          day={data.days[dayIndex]}
          onClose={() => setViewLevel('toc')}
        />
      )}

      {viewLevel === 'toc' && (
        <div className="weekly-review-grid">
          {data.days.map((day, i) => (
            <DayColumn
              key={day.date}
              day={day}
              isFocused={i === dayIndex}
              onClick={() => {
                setDayIndex(i);
                setViewLevel('day');
              }}
            />
          ))}
        </div>
      )}

      {/* Finalize error dialog — shown when upload/finalize fails after recording stops */}
      {modal.type === 'finalizeError' && !isRecording && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              Save failed: {modal.payload}
              <br/>
              <small>Your recording is safe — stored locally and on the server.</small>
            </div>
            <div className="confirm-actions">
              <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 0 ? ' focused' : ''}`} onClick={() => { dispatchModal({ type: 'CLOSE' }); }}>Dismiss</button>
              <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 1 ? ' focused' : ''}`} onClick={() => { dispatchModal({ type: 'CLOSE' }); if (typeof dispatch === 'function') dispatch('escape'); else if (typeof dismiss === 'function') dismiss(); }}>Exit (save later)</button>
            </div>
          </div>
        </div>
      )}

      {/* Stop confirmation overlay */}
      {modal.type === 'stopConfirm' && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">End weekly review recording?</div>
            <div className="confirm-actions">
              <button
                className={`confirm-btn confirm-btn--continue${modal.focusIndex === 0 ? ' focused' : ''}`}
                onClick={() => { logger.info('recording.confirm-continue'); dispatchModal({ type: 'CLOSE' }); }}
              >
                Continue Recording
              </button>
              <button
                className={`confirm-btn confirm-btn--save${modal.focusIndex === 1 ? ' focused' : ''}`}
                onClick={() => { logger.info('recording.confirm-save'); dispatchModal({ type: 'CLOSE' }); stopRecording(); }}
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect modal — shown when mic drops; blocks input while reconnecting or finalizing */}
      {modal.type === 'disconnect' && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              {modal.payload?.phase === 'reconnecting' && (
                <>Microphone dropped — reconnecting…<br/><small>Please hold tight.</small></>
              )}
              {modal.payload?.phase === 'finalizing' && (
                <>Microphone disconnected.<br/><small>Saving your recording…</small></>
              )}
            </div>
          </div>
        </div>
      )}

      <PreFlightOverlay
        status={preflightStatus}
        focusIndex={modal.focusIndex}
        onRetry={() => {
          dispatchModal({ type: 'CLOSE' });
          autoStartRef.current = false;
          stopRecording();
          setTimeout(() => { autoStartRef.current = true; startRecording(); }, 100);
        }}
        onExit={onExitWidget}
      />

      <RecordingBar
        weekLabel={weekLabel}
        isRecording={isRecording}
        duration={recordingDuration}
        micLevel={micLevel}
        silenceWarning={silenceWarning}
        uploading={uploading}
        micConnected={isRecording && !disconnected}
        existingRecording={data.recording}
        error={recorderError}
        syncStatus={uploaderStatus}
        pendingCount={uploaderPendingCount}
        lastAckedAt={uploaderLastAckedAt}
        isFocused={focusRow === 'bar'}
        canSave={isRecording}
        onSave={() => {
          logger.info('nav.bar-save-clicked');
          stopRecording();
        }}
      />
    </div>
  );
}
