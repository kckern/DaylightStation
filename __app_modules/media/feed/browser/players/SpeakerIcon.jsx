export default function SpeakerIcon({ volume, muted, size = 18 }) {
  if (muted || volume === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3z" />
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" />
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  if (volume < 0.5) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3z" />
        <path d="M14 11.5c0.6 0.9 0.6 2.1 0 3" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3z" />
      <path d="M14 11.5c0.6 0.9 0.6 2.1 0 3" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M17 8.5c1.3 1.8 1.3 5.2 0 7" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}
