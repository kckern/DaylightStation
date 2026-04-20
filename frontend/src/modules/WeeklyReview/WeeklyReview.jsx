import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import MenuNavigationContext from '@/context/MenuNavigationContext.jsx';
import DayColumn from './components/DayColumn.jsx';
import DayDetail from './components/DayDetail.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import { useChunkUploader } from './hooks/useChunkUploader.js';
import { deleteSession as deleteLocalSession, listSessions as listLocalSessions, getChunksForSession } from './hooks/chunkDb.js';
import './WeeklyReview.scss';

const logger = getLogger().child({ component: 'weekly-review' });
const COLS = 4;

export default function WeeklyReview({ dispatch, dismiss }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusedDay, setFocusedDay] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [confirmFocus, setConfirmFocus] = useState(0); // 0=continue, 1=save
  const [resumeDraft, setResumeDraft] = useState(null); // { sessionId, source: 'server'|'local', totalBytes?, lastSavedAt, chunkCount? }
  const [resumeFocus, setResumeFocus] = useState(0); // I1: 0=Finalize, 1=Discard
  const [finalizeError, setFinalizeError] = useState(null);
  const [errorFocus, setErrorFocus] = useState(0); // I2: 0=Retry, 1=Exit
  const [focusRow, setFocusRow] = useState('grid'); // 'grid' | 'bar'
  const [barFocus, setBarFocus] = useState(0); // when focusRow='bar': 0=Save, 1=Cancel (future)
  const containerRef = useRef(null);
  const uploadStartRef = useRef(null);
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
  } = useAudioRecorder({ onChunk: handleChunk });

  const finalizeRecording = useCallback(async () => {
    if (!data?.week) return;
    setUploading(true);
    uploadStartRef.current = Date.now();
    try {
      setFinalizeError(null);
      const deadline = Date.now() + 30_000;
      uploaderFlushNow();
      // C1: Use ref-backed count — React state snapshot would be stale inside this async loop
      while (uploaderPendingCountRef.current > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        uploaderFlushNow();
      }
      if (uploaderPendingCountRef.current > 0) {
        logger.warn('recording.finalize-with-pending', { pending: uploaderPendingCountRef.current, sessionId: sessionIdRef.current });
      }
      logger.info('recording.finalize-request', { sessionId: sessionIdRef.current, week: data.week });
      const result = await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: sessionIdRef.current,
        week: data.week,
        duration: recordingDuration,
      }, 'POST');
      logger.info('recording.finalize-complete', { sessionId: sessionIdRef.current, ok: result.ok });
      await deleteLocalSession(sessionIdRef.current).catch(err => logger.warn('recording.local-cleanup-failed', { error: err.message }));
      setData(prev => ({ ...prev, recording: { exists: true, recordedAt: new Date().toISOString(), duration: recordingDuration } }));
      if (typeof dispatch === 'function') dispatch('escape');
      else if (typeof dismiss === 'function') dismiss();
    } catch (err) {
      logger.error('recording.finalize-failed', { sessionId: sessionIdRef.current, error: err.message });
      finalizeTriggeredRef.current = false; // allow retry
      setFinalizeError(err.message);
    } finally {
      setUploading(false);
    }
  }, [data?.week, recordingDuration, uploaderFlushNow, uploaderPendingCountRef, dispatch, dismiss]);

  useEffect(() => {
    logger.info('mount');
    return () => logger.info('unmount');
  }, []);

  useEffect(() => {
    logger.debug('state.focus-day', { day: focusedDay });
  }, [focusedDay]);

  useEffect(() => {
    logger.debug('state.selected-day', { selectedDay });
  }, [selectedDay]);

  useEffect(() => {
    logger.debug('state.uploading', { uploading });
  }, [uploading]);

  // Track when recording starts
  useEffect(() => {
    logger.info('state.is-recording', { isRecording });
    if (isRecording) setHasRecorded(true);
  }, [isRecording]);

  // When recorder finishes (stop pressed), drain uploads and finalize.
  const finalizeTriggeredRef = useRef(false);
  useEffect(() => {
    if (!isRecording && hasRecorded && !finalizeTriggeredRef.current) {
      finalizeTriggeredRef.current = true;
      finalizeRecording();
    }
  }, [isRecording, hasRecorded, finalizeRecording]);

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

  // Pacman grid navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!data?.days) return;
      const total = data.days.length;

      // I1: Resume-draft keyboard nav — must be checked BEFORE init-overlay branch
      if (resumeDraft && !isRecording && !hasRecorded) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setResumeFocus(prev => prev === 0 ? 1 : 0);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (resumeFocus === 0) finalizePriorDraft();
          else discardPriorDraft();
          return;
        }
        if (e.key === 'Escape' || e.key === 'Backspace') {
          // Don't auto-discard on Escape — overlay requires explicit choice
          e.preventDefault();
          return;
        }
        return;
      }

      // I2: Finalize-error keyboard nav — must be checked BEFORE the block-all branch
      if (finalizeError && !isRecording) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setErrorFocus(prev => prev === 0 ? 1 : 0);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (errorFocus === 0) {
            setFinalizeError(null);
            finalizeTriggeredRef.current = false;
            finalizeRecording();
          } else {
            setFinalizeError(null);
            if (typeof dispatch === 'function') dispatch('escape');
            else if (typeof dismiss === 'function') dismiss();
          }
          return;
        }
        return;
      }

      // Not recording and never started: init screen. Enter starts, Escape exits.
      if (!isRecording && !hasRecorded) {
        // I1: Gate Enter-to-start on !resumeDraft so draft overlay isn't bypassed
        if (!resumeDraft && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopPropagation();
          logger.info('recording.key-start');
          startRecording();
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
          // Let it bubble — framework will exit the widget
          logger.info('nav.exit-widget', { key: e.key });
        }
        return;
      }

      // Not recording but has recorded (stopped/uploading): block everything UNLESS the error dialog is showing.
      if (!isRecording && hasRecorded && !finalizeError) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Global save shortcut — works from any focus state
      if (isRecording && (e.key === 's' || e.key === 'S' || e.key === 'MediaStop' || e.key === 'MediaPlayPause')) {
        e.preventDefault();
        e.stopPropagation();
        logger.info('nav.save-shortcut', { key: e.key });
        setShowStopConfirm(false);
        stopRecording();
        return;
      }

      // From here on, we're recording — always capture escape/back ourselves.
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
      }

      // Stop confirmation dialog is showing
      if (showStopConfirm) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape' || e.key === 'Backspace') {
          setShowStopConfirm(false);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          setConfirmFocus(prev => prev === 0 ? 1 : 0);
        } else if (e.key === 'Enter' || e.key === ' ') {
          if (confirmFocus === 0) {
            logger.info('recording.confirm-continue');
            setShowStopConfirm(false);
          } else {
            logger.info('recording.confirm-save');
            setShowStopConfirm(false);
            stopRecording();
          }
        }
        return;
      }

      // Day detail view: back closes detail
      if (selectedDay !== null) {
        switch (e.key) {
          case 'Escape':
          case 'Backspace':
            logger.info('nav.day-detail-close', { fromDay: selectedDay });
            setSelectedDay(null);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            setSelectedDay(prev => {
              const next = (prev - 1 + total) % total;
              logger.info('nav.day-detail-prev', { from: prev, to: next, date: data.days[next]?.date });
              return next;
            });
            break;
          case 'ArrowRight':
            e.preventDefault();
            setSelectedDay(prev => {
              const next = (prev + 1) % total;
              logger.info('nav.day-detail-next', { from: prev, to: next, date: data.days[next]?.date });
              return next;
            });
            break;
          default:
            break;
        }
        return;
      }

      if (focusRow === 'bar') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          logger.info('nav.bar-save-pressed');
          stopRecording();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusRow('grid');
          return;
        }
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault();
          setFocusRow('grid');
          return;
        }
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setFocusedDay(prev => {
            const next = (prev - 1 + total) % total;
            logger.debug('nav.grid-left', { from: prev, to: next });
            return next;
          });
          break;
        case 'ArrowRight':
          e.preventDefault();
          setFocusedDay(prev => {
            const next = (prev + 1) % total;
            logger.debug('nav.grid-right', { from: prev, to: next });
            return next;
          });
          break;
        case 'ArrowUp': {
          e.preventDefault();
          if (focusRow === 'bar') {
            setFocusRow('grid');
            logger.info('nav.focus-grid');
          } else {
            setFocusedDay(prev => {
              const next = (prev - COLS + total) % total;
              logger.debug('nav.grid-up', { from: prev, to: next });
              return next;
            });
          }
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          if (focusRow === 'grid' && focusedDay >= COLS) {
            setFocusRow('bar');
            setBarFocus(0);
            logger.info('nav.focus-bar');
          } else if (focusRow === 'grid') {
            setFocusedDay(prev => {
              const next = (prev + COLS) % total;
              logger.debug('nav.grid-down', { from: prev, to: next });
              return next;
            });
          }
          break;
        }
        case 'Enter':
        case ' ':
          e.preventDefault();
          logger.info('nav.day-detail-open', { day: focusedDay, date: data.days[focusedDay]?.date, photoCount: data.days[focusedDay]?.photoCount });
          setSelectedDay(focusedDay);
          break;
        case 'Escape':
        case 'Backspace':
          // Grid + recording: show stop confirmation
          logger.info('nav.back-show-confirm', { key: e.key });
          setConfirmFocus(0);
          setShowStopConfirm(true);
          break;
        default:
          break;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [data, selectedDay, focusedDay, focusRow, barFocus, isRecording, hasRecorded, finalizeError, errorFocus, showStopConfirm, confirmFocus, resumeDraft, resumeFocus, finalizePriorDraft, discardPriorDraft, finalizeRecording, startRecording, stopRecording, dispatch, dismiss]);

  useEffect(() => {
    containerRef.current?.focus();
  }, [loading]);

  // Pop guard: prevent MenuNavigationContext from popping the app while recording.
  // Handles remote Back button (FKB/Shield popstate) and any other pop() caller.
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  const showStopConfirmRef = useRef(showStopConfirm);
  showStopConfirmRef.current = showStopConfirm;
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const hasRecordedRef = useRef(hasRecorded);
  hasRecordedRef.current = hasRecorded;

  useEffect(() => {
    if (!menuNav?.setPopGuard) return;
    if (!isRecording && !uploading) {
      menuNav.clearPopGuard();
      return;
    }

    menuNav.setPopGuard(() => {
      logger.info('nav.pop-guard', {
        isRecording: isRecordingRef.current,
        uploading,
        selectedDay: selectedDayRef.current,
        showStopConfirm: showStopConfirmRef.current,
      });

      if (uploading) {
        // Upload in progress — block completely
        return false;
      }

      if (showStopConfirmRef.current) {
        setShowStopConfirm(false);
        return false;
      }

      if (selectedDayRef.current !== null) {
        setSelectedDay(null);
        return false;
      }

      // At grid level while recording — show stop confirmation
      setConfirmFocus(0);
      setShowStopConfirm(true);
      return false;
    });

    return () => menuNav.clearPopGuard();
  }, [isRecording, uploading, menuNav]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

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
      {/* Init overlay — only before first recording */}
      {!isRecording && !hasRecorded && (
        <div className="weekly-review-init-overlay" onClick={() => { logger.info('recording.overlay-start'); startRecording(); }}>
          <div className="init-overlay-content">
            <button className="init-record-btn" onClick={(e) => { e.stopPropagation(); logger.info('recording.overlay-btn-start'); startRecording(); }}>
              <span className="init-record-dot" />
            </button>
            <div className="init-record-label">
              Press to start recording.
              <br />
              <small>Press <kbd>S</kbd> or focus the green Save button to finish.</small>
            </div>
            {data.recording?.exists && (
              <div className="init-existing-badge">
                Previous recording: {Math.floor(data.recording.duration / 60)}:{String(data.recording.duration % 60).padStart(2, '0')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resume-draft overlay — shown after bootstrap if an unfinalized draft exists */}
      {resumeDraft && !isRecording && !hasRecorded && (
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

      {selectedDay !== null ? (
        <DayDetail
          day={data.days[selectedDay]}
          isToday={data.days[selectedDay]?.date === todayStr}
          onClose={() => { logger.info('nav.day-detail-close-button'); setSelectedDay(null); }}
        />
      ) : (
        <div className="weekly-review-grid">
          {data.days.map((day, i) => (
            <DayColumn
              key={day.date}
              day={day}
              isFocused={i === focusedDay}
              isToday={day.date === todayStr}
              onClick={() => {
                if (!isRecording) return;
                logger.info('nav.day-click', { day: i, date: day.date, photoCount: day.photoCount });
                setSelectedDay(i);
                setFocusedDay(i);
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
              <button className={`confirm-btn confirm-btn--save${errorFocus === 0 ? ' focused' : ''}`} onClick={() => { setFinalizeError(null); finalizeTriggeredRef.current = false; finalizeRecording(); }}>Retry</button>
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

      <RecordingBar
        weekLabel={weekLabel}
        isRecording={isRecording}
        duration={recordingDuration}
        micLevel={micLevel}
        silenceWarning={silenceWarning}
        uploading={uploading}
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
