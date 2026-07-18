// ComposerBar.jsx — the mode's persistent bottom bar. Navigation only (undo/redo
// live in the editor's own toolbar, where the editor state they act on lives):
//   - editor view  → left "☰ Songs" (open the gallery) + right "ⓘ" (how-to help)
//   - gallery view → left "＋ New song" (back to a fresh blank staff)
// The help panel's open/close state is local — nothing outside the bar needs to
// know the reference sheet is showing.
import { useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { ComposerHelp } from './ComposerHelp.jsx';

export function ComposerBar({ view, onSongs, onNew }) {
  const logger = useMemo(() => getLogger().child({ component: 'composer-bar' }), []);
  const [helpOpen, setHelpOpen] = useState(false);
  const inEditor = view === 'editor';
  const toggleHelp = () => setHelpOpen((v) => { logger.info('composer.help.toggle', { open: !v }); return !v; });
  const closeHelp = () => { logger.info('composer.help.toggle', { open: false }); setHelpOpen(false); };
  return (
    <>
      {helpOpen && <ComposerHelp onClose={closeHelp} />}
      <div className="composer-bar">
        <div className="composer-bar__left">
          {inEditor ? (
            <button type="button" className="composer-bar__btn" onClick={() => { logger.debug('composer.nav.songs', {}); onSongs(); }} aria-label="Your songs">☰ Songs</button>
          ) : (
            <button type="button" className="composer-bar__btn composer-bar__btn--primary" onClick={() => { logger.debug('composer.nav.new', {}); onNew(); }} aria-label="New song">＋ New song</button>
          )}
        </div>
        <div className="composer-bar__right">
          {inEditor && (
            <button
              type="button"
              className="composer-bar__info"
              aria-label="How to write music"
              aria-expanded={helpOpen}
              onClick={toggleHelp}
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
