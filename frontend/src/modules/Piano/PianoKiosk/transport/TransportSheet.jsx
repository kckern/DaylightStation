import TransportButton from './TransportButton.jsx';
import './Transport.scss';

/**
 * TransportSheet — the kiosk's one modal-sheet shell (extracted from the old
 * VolumeModal): full-screen scrim that dismisses on tap, centered sheet, titled
 * header with a 48px close button. Every transport setting (volume, key,
 * tempo, loop) opens one of these; content is children.
 */
export default function TransportSheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="piano-tsheet" role="dialog" aria-label={title} aria-modal="true">
      <button type="button" className="piano-tsheet__scrim" aria-label={`Dismiss ${title}`} onClick={onClose} />
      <div className="piano-tsheet__panel">
        <header className="piano-tsheet__head">
          <h2>{title}</h2>
          <TransportButton icon="close" ariaLabel={`Close ${title}`} emphasis="quiet" onPress={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
