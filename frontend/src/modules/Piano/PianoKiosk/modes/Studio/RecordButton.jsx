import Icon from '../../icons/Icon.jsx';

/** ms → M:SS for the recording read-out. */
function mmss(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Studio Record button — lives at the right end of the tab bar (out of the staff
 * card). Idle → dot + "Record". Recording → red pill with a pulsing white dot, a
 * count-up MM:SS timer, and a stop glyph. Tap toggles capture.
 */
export default function RecordButton({ recording, elapsedMs, onToggle }) {
  return (
    <button
      type="button"
      className={`piano-studio__record${recording ? ' is-recording' : ''}`}
      onClick={onToggle}
      aria-label={recording ? 'Stop recording' : 'Start recording'}
      aria-pressed={recording}
    >
      <span className="piano-studio__record-dot" />
      <span className="piano-studio__record-label">
        {recording ? mmss(elapsedMs) : 'Record'}
      </span>
      {recording && <Icon name="stop" />}
    </button>
  );
}
