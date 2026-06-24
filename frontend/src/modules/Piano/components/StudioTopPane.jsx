import { CurrentChordStaff } from './CurrentChordStaff.jsx';

/**
 * StudioTopPane — the fixed-height white-paper card at the top of the Studio
 * Play and Playback views. Presentational: it owns the card chrome (fixed
 * height, white background, border, radius) and a centered content slot. By
 * default it renders the live grand staff; pass `children` to swap the content
 * (the future music-theory triptych composes in here — see
 * docs/_wip/audits/2026-06-24-piano-studio-theory-triptych-circle-of-fifths-chord-naming.md).
 *
 * @param {React.ReactNode} [children] - content slot; defaults to <CurrentChordStaff/>
 * @param {Map} [activeNotes] - forwarded to the default CurrentChordStaff when no children
 * @param {'center'|'stretch'} [align='center'] - how content sits inside the pane
 * @param {string} [className] - extra class on the card (e.g. a view modifier)
 */
export function StudioTopPane({ children, activeNotes, align = 'center', className = '' }) {
  return (
    <div className={`piano-studio-toppane piano-studio-toppane--${align}${className ? ` ${className}` : ''}`}>
      <div className="piano-studio-toppane__content">
        {children ?? <CurrentChordStaff activeNotes={activeNotes} />}
      </div>
    </div>
  );
}

export default StudioTopPane;
