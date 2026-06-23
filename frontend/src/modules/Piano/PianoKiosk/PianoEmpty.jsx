/** Consistent loading / empty / error message for kiosk lists. */
export default function PianoEmpty({ loading, message }) {
  return (
    <p className="piano-mode__placeholder">
      {loading ? 'Loading…' : (message || 'Nothing here yet.')}
    </p>
  );
}
