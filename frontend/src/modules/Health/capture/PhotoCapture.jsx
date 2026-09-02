import { useRef } from 'react';
import { ActionIcon } from '@mantine/core';

const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="2" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 5l1-2h4l1 2" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** Photo → data URL → the image pipeline. */
export function PhotoCapture({ onCapture, busy }) {
  const inputRef = useRef(null);
  return (
    <>
      <ActionIcon aria-label="Photo log" loading={busy} onClick={() => inputRef.current?.click()}>
        <CameraIcon />
      </ActionIcon>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onCapture(reader.result); // data URL
          reader.readAsDataURL(file);
          e.target.value = '';
        }} />
    </>
  );
}
export default PhotoCapture;
