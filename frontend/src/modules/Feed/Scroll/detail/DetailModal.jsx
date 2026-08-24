import { useEffect, useRef } from 'react';
import DetailView from './DetailView.jsx';
import './DetailView.scss';

export default function DetailModal({ item, sections, ogImage, ogDescription, loading, error, onRetry, onBack, onNext, onPrev, onPlay, activeMedia, playback, onNavigateToItem, onStateAction }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onBack(); return; }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [onBack]);

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
      <div ref={panelRef} className="detail-modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={item?.title || 'Feed item detail'} tabIndex={-1}>
        <DetailView
          item={item}
          sections={sections}
          ogImage={ogImage}
          ogDescription={ogDescription}
          loading={loading}
          error={error}
          onRetry={onRetry}
          onBack={onBack}
          onNext={onNext}
          onPrev={onPrev}
          onPlay={onPlay}
          activeMedia={activeMedia}
          playback={playback}
          onNavigateToItem={onNavigateToItem}
          onStateAction={onStateAction}
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
