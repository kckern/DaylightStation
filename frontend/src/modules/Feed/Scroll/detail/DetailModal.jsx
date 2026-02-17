import DetailView from './DetailView.jsx';
import './DetailView.scss';

export default function DetailModal({ item, sections, ogImage, ogDescription, loading, onBack, onNext, onPrev, onPlay, activeMedia, playback, onNavigateToItem }) {
  return (
    <div className="detail-modal-scrim" onClick={onBack}>
      {onPrev && (
        <button
          className="detail-modal-arrow detail-modal-arrow--left"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          aria-label="Previous item"
        >
          &#8249;
        </button>
      )}
      <div className="detail-modal-panel" onClick={(e) => e.stopPropagation()}>
        <DetailView
          item={item}
          sections={sections}
          ogImage={ogImage}
          ogDescription={ogDescription}
          loading={loading}
          onBack={onBack}
          onNext={onNext}
          onPrev={onPrev}
          onPlay={onPlay}
          activeMedia={activeMedia}
          playback={playback}
          onNavigateToItem={onNavigateToItem}
        />
      </div>
      {onNext && (
        <button
          className="detail-modal-arrow detail-modal-arrow--right"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          aria-label="Next item"
        >
          &#8250;
        </button>
      )}
    </div>
  );
}
