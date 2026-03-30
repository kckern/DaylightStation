import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import DayColumn from './components/DayColumn.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import './WeeklyReview.scss';

const logger = getLogger().child({ component: 'weekly-review' });

export default function WeeklyReview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusedDay, setFocusedDay] = useState(0);
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef(null);
  const uploadStartRef = useRef(null);

  useEffect(() => {
    logger.info('mount');
  }, []);

  useEffect(() => {
    logger.debug('focus-day', { day: focusedDay });
  }, [focusedDay]);

  const handleRecordingComplete = useCallback(async ({ audioBase64, mimeType, duration }) => {
    if (!data?.week) return;
    setUploading(true);
    uploadStartRef.current = Date.now();
    try {
      logger.info('recording.uploading', { week: data.week, duration });
      const result = await DaylightAPI('/api/v1/weekly-review/recording', {
        audioBase64,
        mimeType,
        week: data.week,
        duration,
      }, 'POST');
      const uploadMs = Date.now() - uploadStartRef.current;
      logger.info('recording.complete', { week: data.week, ok: result.ok, uploadMs });
      setData(prev => ({
        ...prev,
        recording: { exists: true, recordedAt: new Date().toISOString(), duration },
      }));
    } catch (err) {
      logger.error('recording.upload-failed', { error: err.message });
    } finally {
      setUploading(false);
    }
  }, [data?.week]);

  const {
    isRecording, duration: recordingDuration, micLevel, silenceWarning,
    error: recorderError, startRecording, stopRecording,
  } = useAudioRecorder({ onRecordingComplete: handleRecordingComplete });

  useEffect(() => {
    const fetchBootstrap = async () => {
      try {
        const result = await DaylightAPI('/api/v1/weekly-review/bootstrap');
        setData(result);
        logger.info('bootstrap.loaded', { week: result.week, dayCount: result.days?.length });
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
    const handleKeyDown = (e) => {
      if (!data?.days) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setFocusedDay(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setFocusedDay(prev => Math.min(data.days.length - 1, prev + 1));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (isRecording) {
            stopRecording();
          } else {
            startRecording();
          }
          break;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [data, isRecording, startRecording, stopRecording]);

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
      <div className="weekly-review-grid">
        {data.days.map((day, i) => (
          <DayColumn
            key={day.date}
            day={day}
            isFocused={i === focusedDay}
            isToday={day.date === todayStr}
          />
        ))}
      </div>

      <RecordingBar
        weekLabel={weekLabel}
        isRecording={isRecording}
        duration={recordingDuration}
        micLevel={micLevel}
        silenceWarning={silenceWarning}
        uploading={uploading}
        existingRecording={data.recording}
        error={recorderError}
        onStart={startRecording}
        onStop={stopRecording}
      />
    </div>
  );
}
