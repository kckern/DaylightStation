// ComposerHelp.jsx — the dismissible "(i)" panel that explains the numpad map.
// Reads KEY_LEGEND (the SSOT next to mapKey in useComposerInput.js) so the help
// text can never drift from the keys that are actually wired up. Shown until the
// physical key stickers / first-run coach (spec §5.1 / §9.1) exist — and useful
// as a permanent reference after that. Closes on the X, the backdrop, or Escape.
import { useEffect } from 'react';
import { KEY_LEGEND } from './useComposerInput.js';
import { IconClose } from './icons.jsx';

export function ComposerHelp({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="composer-help" role="dialog" aria-modal="true" aria-label="How to compose" onClick={onClose}>
      <div className="composer-help__panel" onClick={(e) => e.stopPropagation()}>
        {/* Drawn, not typeset: this is the panel's only visible way out, and a
            Unicode cross with no glyph on the kiosk would render as a blank box. */}
        <button type="button" className="composer-help__close" aria-label="Close" onClick={onClose}><IconClose size={20} /></button>
        <h2 className="composer-help__title">How to write music</h2>
        <p className="composer-help__lede">
          The <strong>number pad</strong> picks <strong>how long</strong> a note is.
          The <strong>piano</strong> picks <strong>which note</strong> it is.
          Press <strong>4</strong> to turn <strong>Write</strong> on, choose a length, then play.
        </p>
        {KEY_LEGEND.map((section) => (
          <div key={section.group} className="composer-help__group">
            <h3 className="composer-help__group-title">{section.group}</h3>
            <ul className="composer-help__rows">
              {section.keys.map((k) => (
                <li key={k.label} className="composer-help__row">
                  <span className="composer-help__key">{k.label}</span>
                  <span className="composer-help__does">{k.does}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ComposerHelp;
