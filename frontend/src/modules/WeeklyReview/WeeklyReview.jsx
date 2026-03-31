import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import DayColumn from './components/DayColumn.jsx';
import DayDetail from './components/DayDetail.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import './WeeklyReview.scss';

const logger = getLogger().child({ component: 'weekly-review' });
const COLS = 4;

export default function WeeklyReview({ dispatch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusedDay, setFocusedDay] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const containerRef = useRef(null);
  const uploadStartRef = useRef(null);

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

  const handleRecordingComplete = useCallback(async ({ audioBase64, mimeType, duration }) => {
    if (!data?.week) return;
    setUploading(true);
    uploadStartRef.current = Date.now();
    const payloadSizeKb = Math.round(audioBase64.length / 1024);
    try {
      logger.info('recording.uploading', { week: data.week, duration, payloadSizeKb });
      const result = await DaylightAPI('/api/v1/weekly-review/recording', {
        audioBase64,
        mimeType,
        week: data.week,
        duration,
      }, 'POST');
      const uploadMs = Date.now() - uploadStartRef.current;
      logger.info('recording.upload-complete', { week: data.week, ok: result.ok, uploadMs, payloadSizeKb });
      setData(prev => ({
        ...prev,
        recording: { exists: true, recordedAt: new Date().toISOString(), duration },
      }));
    } catch (err) {
      const uploadMs = Date.now() - uploadStartRef.current;
      logger.error('recording.upload-failed', { error: err.message, uploadMs, payloadSizeKb });
    } finally {
      setUploading(false);
    }
  }, [data?.week]);

  const {
    isRecording, duration: recordingDuration, micLevel, silenceWarning,
    error: recorderError, startRecording, stopRecording,
  } = useAudioRecorder({ onRecordingComplete: handleRecordingComplete });

  // Track when recording starts
  useEffect(() => {
    logger.info('state.is-recording', { isRecording });
    if (isRecording) setHasRecorded(true);
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

  // Pacman grid navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!data?.days) return;
      const total = data.days.length;

      // Not recording and never started: init screen. Enter starts, Escape exits.
      if (!isRecording && !hasRecorded) {
        if (e.key === 'Enter' || e.key === ' ') {
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

      // Not recording but has recorded (stopped/uploading): block everything.
      if (!isRecording && hasRecorded) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // From here on, we're recording — always capture escape/back ourselves.
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
      }

      // Stop confirmation dialog is showing
      if (showStopConfirm) {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          setShowStopConfirm(false);
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
        case 'ArrowUp':
          e.preventDefault();
          setFocusedDay(prev => {
            const next = (prev - COLS + total) % total;
            logger.debug('nav.grid-up', { from: prev, to: next });
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedDay(prev => {
            const next = (prev + COLS) % total;
            logger.debug('nav.grid-down', { from: prev, to: next });
            return next;
          });
          break;
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
  }, [data, selectedDay, focusedDay, isRecording, hasRecorded, showStopConfirm, startRecording, stopRecording, dispatch]);

  useEffect(() => {
    containerRef.current?.focus();
  }, [loading]);

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
            <div className="init-record-label">Press to start recording your weekly review</div>
            {data.recording?.exists && (
              <div className="init-existing-badge">
                Previous recording: {Math.floor(data.recording.duration / 60)}:{String(data.recording.duration % 60).padStart(2, '0')}
              </div>
            )}
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

      {/* Stop confirmation overlay */}
      {showStopConfirm && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">End weekly review recording?</div>
            <div className="confirm-actions">
              <button
                className="confirm-btn confirm-btn--continue"
                onClick={() => { logger.info('recording.confirm-continue'); setShowStopConfirm(false); }}
              >
                Continue Recording
              </button>
              <button
                className="confirm-btn confirm-btn--save"
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
      />
    </div>
  );
}
