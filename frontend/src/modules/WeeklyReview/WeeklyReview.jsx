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
import './WeeklyReview.scss';

const logger = getLogger().child({ component: 'weekly-review' });

export default function WeeklyReview({ dispatch, dismiss }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // eslint-disable-next-line no-unused-vars -- setUploading kept; Task 14 may revive or remove it
  const [uploading, setUploading] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [confirmFocus, setConfirmFocus] = useState(0); // 0=continue, 1=save
  const [resumeDraft, setResumeDraft] = useState(null); // { sessionId, source: 'server'|'local', totalBytes?, lastSavedAt, chunkCount? }
  // eslint-disable-next-line no-unused-vars -- Task 13 removes Discard affordances; setResumeFocus will be deleted then
  const [resumeFocus, setResumeFocus] = useState(0); // I1: 0=Finalize, 1=Discard
  const [finalizeError, setFinalizeError] = useState(null);
  const [errorFocus, setErrorFocus] = useState(0); // I2: 0=Retry, 1=Exit
  const [uploadInFlight, setUploadInFlight] = useState(false);
  const lastUploadAtRef = useRef(0);

  // Task 8: viewLevel state machine — replaces selectedDay/focusedDay/focusRow/barFocus
  const [viewLevel, setViewLevel] = useState('toc');           // 'toc' | 'day' | 'fullscreen'
  const [dayIndex, setDayIndex] = useState(0);                 // always valid once data loads
  const [imageIndex, setImageIndex] = useState(0);             // valid when viewLevel === 'fullscreen'

  // Task 9: focus row, preflight, and disconnect modal state
  const [focusRow, setFocusRow] = useState('main');            // 'main' | 'bar'
  const [preflightFailed, setPreflightFailed] = useState(false);
  const [preflightFocus, setPreflightFocus] = useState(0);     // 0=Retry, 1=Exit
  const [disconnectModal, setDisconnectModal] = useState(null);

  const containerRef = useRef(null);
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

  const preflightStatus = preflightFailed
    ? 'failed'
    : (firstAudibleFrameSeen ? 'ok' : 'acquiring');

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

  // Task 11: Enter triggers finalize while recording continues.
  const onEnterUpload = useCallback(async () => {
    if (uploadInFlight) {
      logger.info('upload.skip-in-flight');
      return;
    }
    if (Date.now() - lastUploadAtRef.current < 1000) {
      logger.info('upload.skip-debounced');
      return;
    }
    if (!data?.week) return;
    lastUploadAtRef.current = Date.now();
    setUploadInFlight(true);
    try {
      logger.info('upload.finalize-request', { sessionId: sessionIdRef.current, week: data.week });
      uploaderFlushNow();
      // Wait briefly for in-memory queue to drain before finalize. Don't block forever — server tolerates partial.
      const drainDeadline = Date.now() + 3000;
      while (uploaderPendingCountRef.current > 0 && Date.now() < drainDeadline) {
        await new Promise(r => setTimeout(r, 200));
        uploaderFlushNow();
      }
      await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: sessionIdRef.current,
        week: data.week,
        duration: recordingDuration,
      }, 'POST');
      logger.info('upload.finalize-complete');
    } catch (err) {
      logger.warn('upload.finalize-failed', { error: err.message });
      // Non-blocking — just toast on the bar; pipeline continues.
    } finally {
      setUploadInFlight(false);
    }
  }, [data?.week, recordingDuration, uploaderFlushNow, uploaderPendingCountRef, uploadInFlight]);

  const onPreflightRetry = useCallback(() => {
    setPreflightFailed(false);
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
    setConfirmFocus(0);
    setShowStopConfirm(true);
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

  useEffect(() => {
    if (firstAudibleFrameSeen) {
      setPreflightFailed(false);
      return;
    }
    if (!isRecording) return;
    const timer = setTimeout(() => {
      if (!firstAudibleFrameSeen) {
        logger.warn('recording.preflight-timeout');
        setPreflightFailed(true);
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
      setDisconnectModal({ phase: 'reconnecting' });
      const ok = await reconnect();
      if (ok) {
        logger.info('disconnect.recovered');
        setDisconnectModal(null);
        return;
      }
      logger.warn('disconnect.reconnect-failed-finalizing');
      setDisconnectModal({ phase: 'finalizing' });
      try {
        uploaderFlushNow();
        await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
          sessionId: sessionIdRef.current, week: data?.week, duration: recordingDuration,
        }, 'POST');
        await deleteLocalSession(sessionIdRef.current).catch(() => {});
        setDisconnectModal(null);
        onExitWidget();
      } catch (err) {
        logger.error('disconnect.finalize-failed', { error: err.message });
        setDisconnectModal(null);
        setFinalizeError(err.message);
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
          setResumeDraft({ sessionId: serverDraft.sessionId, source: 'server', totalBytes: serverDraft.totalBytes, lastSavedAt: serverDraft.updatedAt });
          return;
        }
        const localSessions = await listLocalSessions();
        const localDraft = localSessions
          .filter(s => s.week === data.week && s.sessionId !== sessionIdRef.current && s.unuploadedCount > 0)
          .sort((a, b) => b.lastSavedAt - a.lastSavedAt)[0];
        if (localDraft && !cancelled) {
          logger.info('recording.resume-candidate.local', localDraft);
          setResumeDraft({ sessionId: localDraft.sessionId, source: 'local', totalBytes: null, lastSavedAt: new Date(localDraft.lastSavedAt).toISOString(), chunkCount: localDraft.chunkCount });
        }
      } catch (err) {
        logger.warn('recording.resume-check-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [data?.week]);

  const finalizePriorDraft = useCallback(async () => {
    if (!resumeDraft?.sessionId || !data?.week) return;
    try {
      logger.info('recording.resume.finalize', { sessionId: resumeDraft.sessionId, source: resumeDraft.source });
      if (resumeDraft.source === 'local') {
        const rows = await getChunksForSession(resumeDraft.sessionId);
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
              await DaylightAPI('/api/v1/weekly-review/recording/chunk', { sessionId: resumeDraft.sessionId, seq: row.seq, week: data.week, chunkBase64 }, 'POST');
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
      if (resumeDraft.source === 'local') {
        // chunkCount * 5 seconds per chunk
        estimatedDuration = (resumeDraft.chunkCount || 0) * 5;
      } else if (resumeDraft.source === 'server') {
        // Server drafts: estimate from totalBytes and typical opus bitrate ~24kbps (3000 bytes/sec)
        estimatedDuration = Math.round((resumeDraft.totalBytes || 0) / 3000);
      }
      await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: resumeDraft.sessionId, week: data.week, duration: estimatedDuration,
      }, 'POST');
      await deleteLocalSession(resumeDraft.sessionId);
      setResumeDraft(null);
      const fresh = await DaylightAPI('/api/v1/weekly-review/bootstrap');
      setData(fresh);
    } catch (err) {
      logger.error('recording.resume.finalize-failed', { error: err.message });
    }
  }, [resumeDraft, data?.week]);

  const discardPriorDraft = useCallback(async () => {
    if (!resumeDraft?.sessionId || !data?.week) return;
    try {
      if (resumeDraft.source === 'server') {
        await DaylightAPI(`/api/v1/weekly-review/recording/drafts/${resumeDraft.sessionId}?week=${data.week}`, {}, 'DELETE');
      }
      await deleteLocalSession(resumeDraft.sessionId);
      setResumeDraft(null);
    } catch (err) {
      logger.error('recording.resume.discard-failed', { error: err.message });
    }
  }, [resumeDraft, data?.week]);

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
      if (!data?.days) return;
      const total = data.days.length;
      const isEnter = e.key === 'Enter' || e.key === ' ';
      const isBack  = e.key === 'Escape' || e.key === 'Backspace';

      // ---- Overlay-specific handling. These modals override "Enter = upload" ----

      // Pre-flight: only Back works (to bail). Other keys ignored.
      if (preflightStatus !== 'ok') {
        if (isBack) {
          e.preventDefault();
          onExitWidget();
          return;
        }
        // Pre-flight failed has its own Retry/Exit buttons; route L/R + Enter:
        if (preflightStatus === 'failed') {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setPreflightFocus(prev => prev === 0 ? 1 : 0);
          } else if (isEnter) {
            e.preventDefault();
            if (preflightFocus === 0) onPreflightRetry(); else onPreflightExit();
          }
        }
        return;
      }

      // Disconnect modal: informational while reconnecting/finalizing — swallow all keys.
      if (disconnectModal) {
        e.preventDefault();
        return;
      }

      // Stop-confirm modal: existing behavior (L/R toggles focus, Enter activates).
      if (showStopConfirm) {
        e.preventDefault();
        if (isBack) { setShowStopConfirm(false); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          setConfirmFocus(prev => prev === 0 ? 1 : 0); return;
        }
        if (isEnter) {
          if (confirmFocus === 0) { setShowStopConfirm(false); }
          else { setShowStopConfirm(false); onSaveAndExit(); }
          return;
        }
        return;
      }

      // Finalize-error modal: L/R toggles focus, Enter activates Retry / Exit-save-later.
      if (finalizeError) {
        e.preventDefault();
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          setErrorFocus(prev => prev === 0 ? 1 : 0); return;
        }
        if (isEnter) {
          if (errorFocus === 0) { setFinalizeError(null); onEnterUpload(); }
          else {
            setFinalizeError(null);
            onExitWidget();
          }
          return;
        }
        return;
      }

      // Resume-draft overlay (single-button after Task 13): Enter activates Finalize.
      if (resumeDraft) {
        e.preventDefault();
        if (isEnter) finalizePriorDraft();
        // No Discard option, no L/R toggle. Back is intentionally a no-op (must explicitly finalize).
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

      // ---- Main hierarchy: Enter = upload, Back = climb ----
      if (isEnter) {
        e.preventDefault();
        e.stopPropagation();
        onEnterUpload();
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

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [data, viewLevel, dayIndex, imageIndex, focusRow, resumeDraft, finalizeError, showStopConfirm, preflightStatus, preflightFocus, confirmFocus, errorFocus, disconnectModal, finalizePriorDraft, onExitWidget, onSaveAndExit, onEnterUpload, onPreflightRetry, onPreflightExit, onBackPressed]);

  useEffect(() => {
    containerRef.current?.focus();
  }, [loading]);

  // Pop guard: prevent MenuNavigationContext from popping the app while recording or uploading.
  // Handles remote Back button (FKB/Shield popstate) and any other pop() caller.
  const showStopConfirmRef = useRef(showStopConfirm);
  showStopConfirmRef.current = showStopConfirm;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const viewLevelRef = useRef(viewLevel);
  viewLevelRef.current = viewLevel;

  useEffect(() => {
    if (!menuNav?.setPopGuard) return;
    if (!isRecording && !uploadInFlight) {
      menuNav.clearPopGuard();
      return;
    }

    menuNav.setPopGuard(() => {
      logger.info('nav.pop-guard', {
        isRecording: isRecordingRef.current,
        uploadInFlight: uploadInFlight,
        viewLevel: viewLevelRef.current,
        showStopConfirm: showStopConfirmRef.current,
      });

      if (uploadInFlight) return false;

      if (showStopConfirmRef.current) { setShowStopConfirm(false); return false; }
      if (viewLevelRef.current === 'fullscreen') { setViewLevel('day'); return false; }
      if (viewLevelRef.current === 'day')        { setViewLevel('toc'); return false; }
      setConfirmFocus(0);
      setShowStopConfirm(true);
      return false;
    });

    return () => menuNav.clearPopGuard();
  }, [isRecording, uploadInFlight, menuNav]);

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
    <div className="weekly-review" ref={containerRef} tabIndex={0}>
      {/* Resume-draft overlay — shown after bootstrap if an unfinalized draft exists */}
      {resumeDraft && !isRecording && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              A previous recording was not finalized.<br/>
              <small>{resumeDraft.source === 'server' ? `Server draft · ${Math.round((resumeDraft.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${resumeDraft.chunkCount || 0} chunks`}</small>
            </div>
            <div className="confirm-actions">
              <button className={`confirm-btn confirm-btn--save${resumeFocus === 0 ? ' focused' : ''}`} onClick={finalizePriorDraft}>Finalize Previous</button>
              <button className={`confirm-btn confirm-btn--continue${resumeFocus === 1 ? ' focused' : ''}`} onClick={discardPriorDraft}>Discard</button>
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
      {finalizeError && !isRecording && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              Save failed: {finalizeError}
              <br/>
              <small>Your recording is safe — stored locally and on the server.</small>
            </div>
            <div className="confirm-actions">
              <button className={`confirm-btn confirm-btn--save${errorFocus === 0 ? ' focused' : ''}`} onClick={() => { setFinalizeError(null); onEnterUpload(); }}>Retry</button>
              <button className={`confirm-btn confirm-btn--continue${errorFocus === 1 ? ' focused' : ''}`} onClick={() => { setFinalizeError(null); if (typeof dispatch === 'function') dispatch('escape'); else if (typeof dismiss === 'function') dismiss(); }}>Exit (save later)</button>
            </div>
          </div>
        </div>
      )}

      {/* Stop confirmation overlay */}
      {showStopConfirm && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">End weekly review recording?</div>
            <div className="confirm-actions">
              <button
                className={`confirm-btn confirm-btn--continue${confirmFocus === 0 ? ' focused' : ''}`}
                onClick={() => { logger.info('recording.confirm-continue'); setShowStopConfirm(false); }}
              >
                Continue Recording
              </button>
              <button
                className={`confirm-btn confirm-btn--save${confirmFocus === 1 ? ' focused' : ''}`}
                onClick={() => { logger.info('recording.confirm-save'); setShowStopConfirm(false); stopRecording(); }}
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect modal — shown when mic drops; blocks input while reconnecting or finalizing */}
      {disconnectModal && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              {disconnectModal.phase === 'reconnecting' && (
                <>Microphone dropped — reconnecting…<br/><small>Please hold tight.</small></>
              )}
              {disconnectModal.phase === 'finalizing' && (
                <>Microphone disconnected.<br/><small>Saving your recording…</small></>
              )}
            </div>
          </div>
        </div>
      )}

      <PreFlightOverlay
        status={preflightStatus}
        onRetry={() => {
          setPreflightFailed(false);
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
        uploadInFlight={uploadInFlight}
        existingRecording={data.recording}
        error={recorderError}
        onStart={() => { logger.info('recording.manual-start'); startRecording(); }}
        onStop={() => { logger.info('recording.manual-stop'); setShowStopConfirm(true); }}
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
