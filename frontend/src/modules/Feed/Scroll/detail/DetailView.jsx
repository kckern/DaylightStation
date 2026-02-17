import { useState, useRef, useCallback, useEffect } from 'react';
import { formatAge, proxyIcon, colorFromLabel } from '../cards/utils.js';
import { renderSection } from './sections/index.jsx';
import './DetailView.scss';

export default function DetailView({ item, sections, ogImage, ogDescription, loading, onBack, onNext, onPrev, onPlay, activeMedia, onNavigateToItem }) {
  const sourceName = item.meta?.sourceName || item.source || '';
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colorFromLabel(sourceName);
  const age = formatAge(item.timestamp);
  const heroImage = item.image || ogImage;
  const subtitle = item.body || ogDescription;
  const hasArticle = sections.length > 0 && !loading;
  const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  const [imageLoaded, setImageLoaded] = useState(false);
  const contentRef = useRef(null);
  const dirRef = useRef(0); // -1 = prev, 1 = next

  // Reset image loaded state when hero image changes
  useEffect(() => {
    setImageLoaded(false);
  }, [heroImage]);

  // Slide-in animation when item changes (Web Animations API for TV compat)
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !dirRef.current) return;
    const from = dirRef.current > 0 ? '60px' : '-60px';
    el.animate(
      [
        { transform: `translateX(${from})`, opacity: 0 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      { duration: 200, easing: 'ease-out', fill: 'forwards' }
    );
    dirRef.current = 0;
  }, [item.id]);

  const navigateWithAnimation = useCallback((direction, handler) => {
    if (!handler) return;
    const el = contentRef.current;
    if (!el) { handler(); return; }
    const to = direction > 0 ? '-60px' : '60px';
    dirRef.current = direction;
    const anim = el.animate(
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${to})`, opacity: 0 },
      ],
      { duration: 150, easing: 'ease-in', fill: 'forwards' }
    );
    anim.onfinish = () => handler();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onBack();
      if (e.key === 'ArrowLeft' && onPrev) navigateWithAnimation(-1, onPrev);
      if (e.key === 'ArrowRight' && onNext) navigateWithAnimation(1, onNext);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack, onNext, onPrev, navigateWithAnimation]);

  const touchRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (!touchRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    const dt = Date.now() - touchRef.current.time;
    touchRef.current = null;

    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7 || dt > 400) return;

    if (dx < 0 && onNext) navigateWithAnimation(1, onNext);
    if (dx > 0 && onPrev) navigateWithAnimation(-1, onPrev);
  }, [onNext, onPrev, navigateWithAnimation]);

  return (
    <div className="detail-view" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button className="detail-close" onClick={onBack} aria-label="Back to feed">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
      <div ref={contentRef} className="detail-content">
        <div className="detail-source-bar" style={{ borderTop: `2px solid ${borderColor}` }}>
          {iconUrl && <img src={iconUrl} alt="" className="detail-source-icon" onError={(e) => { e.target.style.display = 'none'; }} />}
          <span className="detail-source-label">{sourceName}</span>
          <span className="detail-source-age">{age}</span>
        </div>

        {heroImage && !sections.some(s => s.type === 'player' || s.type === 'embed') && (
          <div className="detail-hero" style={{
            aspectRatio: (item.meta?.imageWidth && item.meta?.imageHeight)
              ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
              : '16 / 9',
          }}>
            {!imageLoaded && <div className="detail-hero-shimmer" />}
            <img
              src={heroImage}
              alt=""
              onLoad={() => setImageLoaded(true)}
              style={imageLoaded ? undefined : { position: 'absolute', opacity: 0 }}
            />
          </div>
        )}

        <div className="detail-title-area">
          <h2 className="detail-title">{item.title}</h2>
          {dateStr && <span className="detail-date">{dateStr}</span>}
          {!hasArticle && subtitle && <p className="detail-subtitle">{subtitle}</p>}
          {item.link && (
            <a href={item.meta?.paywall && item.meta?.paywallProxy ? item.meta.paywallProxy + item.link : item.link} target="_blank" rel="noopener noreferrer" className="detail-open-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
              </svg>
              {item.meta?.paywall ? 'Open via archive' : 'Open in browser'}
            </a>
          )}
        </div>

        {loading && (
          <div className="detail-loading">
            <div className="scroll-loading-dots"><span /><span /><span /></div>
          </div>
        )}

        {!loading && sections.map((section, i) => (
          <div key={i} className="detail-section">
            {renderSection(section, { onPlay, activeMedia, item, onNavigateToItem })}
          </div>
        ))}

      </div>
    </div>
  );
}
