// ComposerBar.jsx — the mode's persistent bottom bar. Navigation only (undo/redo
// live in the editor's own toolbar, where the editor state they act on lives):
//   - editor view  → left "☰ Songs" (open the gallery) + right "ⓘ" (how-to help)
//   - gallery view → left "＋ New song" (back to a fresh blank staff)
// The help panel's open/close state is local — nothing outside the bar needs to
// know the reference sheet is showing.
import { useState } from 'react';
import { ComposerHelp } from './ComposerHelp.jsx';

export function ComposerBar({ view, onSongs, onNew }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const inEditor = view === 'editor';
  return (
    <>
      {helpOpen && <ComposerHelp onClose={() => setHelpOpen(false)} />}
      <div className="composer-bar">
        <div className="composer-bar__left">
          {inEditor ? (
            <button type="button" className="composer-bar__btn" onClick={onSongs} aria-label="Your songs">☰ Songs</button>
          ) : (
            <button type="button" className="composer-bar__btn composer-bar__btn--primary" onClick={onNew} aria-label="New song">＋ New song</button>
          )}
        </div>
        <div className="composer-bar__right">
          {inEditor && (
            <button
              type="button"
              className="composer-bar__info"
              aria-label="How to write music"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((v) => !v)}
            >
              ⓘ
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default ComposerBar;
