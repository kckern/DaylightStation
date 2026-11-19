import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFocusTrap, useMergedRef } from '@mantine/hooks';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import DetailView from "./DetailView.jsx";
import "./DetailView.scss";

export default function DetailModal({ item, sections, ogImage, ogDescription, loading, error, onRetry, onBack, onNext, onPrev, onPlay, activeMedia, playback, onNavigateToItem, onStateAction }) {
  const dialogRef = useRef(null);
  const trapRef = useFocusTrap();
  const ref = useMergedRef(dialogRef, trapRef);
  const usesDismissStack = useDismissLayer(true, onBack);

  useLayoutEffect(() => {
    const opener = document.activeElement;
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    // An adjacent item control can disappear at either end of the list.
    if (document.activeElement === document.body) {
      dialogRef.current?.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
    }
  }, [item?.id]);

  useEffect(() => {
    if (usesDismissStack) return;
    const handleEscape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target?.getAttribute?.('data-mantine-stop-propagation') === 'true') return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [usesDismissStack, onBack]);

  const renderDialog = (article, onKeyDown) => (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      className="detail-modal-scrim"
      onClick={event => { if (event.target === event.currentTarget) onBack(); }}
      role="dialog"
      aria-modal="true"
      aria-label={item?.title || 'Feed item detail'}
      tabIndex={-1}
    >
      <div className="detail-modal-panel">
        {article}
      </div>
      {onPrev && (
        <button
          type="button"
          className="detail-modal-arrow detail-modal-arrow--left"
          onClick={() => onPrev()}
          aria-label="Previous item"
        >
          &#8249;
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="detail-modal-arrow detail-modal-arrow--right"
          onClick={() => onNext()}
          aria-label="Next item"
        >
          &#8250;
        </button>
      )}
    </div>
  );

  return (
    <DetailView
      renderDialog={renderDialog}
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
  );
}
