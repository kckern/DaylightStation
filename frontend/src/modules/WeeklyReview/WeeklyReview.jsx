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

export default function WeeklyReview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusedDay, setFocusedDay] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
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

  useEffect(() => {
    logger.debug('state.has-interacted', { hasInteracted });
  }, [hasInteracted]);

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

  // Log recording state changes
  useEffect(() => {
    logger.info('state.is-recording', { isRecording });
  }, [isRecording]);

  useEffect(() => {
    if (recorderError) {
      logger.error('state.recorder-error', { error: recorderError });
    }
  }, [recorderError]);

  // Auto-start recording on first non-back interaction
  const ensureRecording = useCallback(() => {
    if (!hasInteracted) {
      setHasInteracted(true);
      if (!isRecording) {
        logger.info('recording.auto-start');
        startRecording();
      }
    }
  }, [hasInteracted, isRecording, startRecording]);

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

      // Day detail view has its own nav
      if (selectedDay !== null) {
        switch (e.key) {
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            logger.info('nav.day-detail-close', { fromDay: selectedDay });
            setSelectedDay(null);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            ensureRecording();
            setSelectedDay(prev => {
              const next = (prev - 1 + total) % total;
              logger.info('nav.day-detail-prev', { from: prev, to: next, date: data.days[next]?.date });
              return next;
            });
            break;
          case 'ArrowRight':
            e.preventDefault();
            ensureRecording();
            setSelectedDay(prev => {
              const next = (prev + 1) % total;
              logger.info('nav.day-detail-next', { from: prev, to: next, date: data.days[next]?.date });
              return next;
            });
            break;
          default:
            logger.debug('nav.day-detail-key-ignored', { key: e.key });
            break;
        }
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          ensureRecording();
          setFocusedDay(prev => {
            const next = (prev - 1 + total) % total;
            logger.debug('nav.grid-left', { from: prev, to: next });
            return next;
          });
          break;
        case 'ArrowRight':
          e.preventDefault();
          ensureRecording();
          setFocusedDay(prev => {
            const next = (prev + 1) % total;
            logger.debug('nav.grid-right', { from: prev, to: next });
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          ensureRecording();
          setFocusedDay(prev => {
            const next = (prev - COLS + total) % total;
            logger.debug('nav.grid-up', { from: prev, to: next });
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          ensureRecording();
          setFocusedDay(prev => {
            const next = (prev + COLS) % total;
            logger.debug('nav.grid-down', { from: prev, to: next });
            return next;
          });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          ensureRecording();
          logger.info('nav.day-detail-open', { day: focusedDay, date: data.days[focusedDay]?.date, photoCount: data.days[focusedDay]?.photoCount });
          setSelectedDay(focusedDay);
          break;
        case 'Escape':
        case 'Backspace':
          logger.info('nav.back', { key: e.key });
          break;
        default:
          logger.debug('nav.grid-key-ignored', { key: e.key });
          break;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [data, selectedDay, focusedDay, ensureRecording]);

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

  const dimmed = !isRecording;

  return (
    <div className={`weekly-review${dimmed ? ' weekly-review--dimmed' : ''}`} ref={containerRef} tabIndex={0}>
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
                logger.info('nav.day-click', { day: i, date: day.date, photoCount: day.photoCount });
                ensureRecording();
                setSelectedDay(i);
                setFocusedDay(i);
              }}
            />
          ))}
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
        onStop={() => { logger.info('recording.manual-stop'); stopRecording(); }}
      />
    </div>
  );
}
