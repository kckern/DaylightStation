// ComposerBar.jsx — the mode's persistent bottom bar: back-to-gallery (only
// once a song is open) + undo/redo placeholders (real history wiring lands in
// a later task; the buttons exist now so the bar's layout is settled).
export function ComposerBar({ onBack, onUndo, onRedo, canBack }) {
  return (
    <div className="composer-bar">
      <div className="composer-bar__left">
        {canBack && <button type="button" onClick={onBack} aria-label="Back to gallery">‹ Songs</button>}
      </div>
      <div className="composer-bar__right">
        <button type="button" onClick={onUndo} aria-label="Undo">undo</button>
        <button type="button" onClick={onRedo} aria-label="Redo">redo</button>
      </div>
    </div>
  );
}

export default ComposerBar;
