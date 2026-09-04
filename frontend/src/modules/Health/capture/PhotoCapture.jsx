import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Button } from '@mantine/core';
import { useCaptureTask } from './useCaptureTask.js';

const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="2" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 5l1-2h4l1 2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/**
 * Photo → data URL → the image pipeline.
 *
 * See VoiceCapture.jsx's header comment for the `bucket`/`mealLabel`/
 * `labelPrefix`/`className` contract — same shape here: optional,
 * meal-scoped naming + forwarding, with `labelPrefix` letting
 * QuickCaptureBar's global instance read as "Quick photo log to X" instead
 * of the per-meal header's "Log by photo to X".
 */
export function PhotoCapture({ onCapture, busy, bucket, mealLabel, labelPrefix, className }) {
  const inputRef = useRef(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const task = useCaptureTask();
  const readerRef = useRef(null);
  useEffect(() => () => { const reader = readerRef.current; if (reader) { reader.onload = null; reader.onerror = null; if (reader.readyState === 1) reader.abort(); } }, []);
  const label = labelPrefix
    ? `${labelPrefix} to ${mealLabel}`
    : (mealLabel ? `Log by photo to ${mealLabel}` : 'Photo log');
  return (
    <>
      <ActionIcon aria-label={label} loading={pending || task.pending}
        className={className || (mealLabel ? 'health-meal__capture-btn' : undefined)}
        onClick={() => inputRef.current?.click()}>
        <CameraIcon />
      </ActionIcon>
      {error || task.error ? <span role="alert" className="health-capture-error">{error || task.error}</span> : null}
      {task.retry ? <Button size="compact-xs" disabled={task.pending} onClick={task.retry}>Retry photo</Button> : null}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file || pendingRef.current) return;
          pendingRef.current = true; setPending(true); setError(null);
          const reader = new FileReader();
          readerRef.current = reader;
          const finish = () => { pendingRef.current = false; setPending(false); };
          reader.onerror = () => { setError('Photo could not be read. Try another photo.'); finish(); };
          reader.onload = async () => {
            try { await task.run(() => onCapture(reader.result, bucket)); }
            finally { finish(); }
          };
          reader.readAsDataURL(file);
          e.target.value = '';
        }} />
    </>
  );
}
export default PhotoCapture;
