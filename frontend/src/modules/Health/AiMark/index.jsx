import './AiMark.scss';

/**
 * Gradient circle with the ✦ glyph — the consistent AI mark used across
 * AskBar, ChatOverlay header, and tool-call attribution rows.
 */
export function AiMark({ size = 24 }) {
  const fontSize = Math.round(size * 0.5);
  return (
    <span
      className="ai-mark"
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${fontSize}px` }}
      aria-hidden="true"
    >
      ✦
    </span>
  );
}

export default AiMark;
