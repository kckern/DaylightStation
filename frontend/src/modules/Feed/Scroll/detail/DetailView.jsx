import { useState, useRef, useCallback, useEffect } from 'react';
import { formatAge, proxyIcon, proxyImage, colorFromLabel } from '../cards/utils.js';
import { renderSection } from './sections/index.jsx';
import { feedLog } from '../feedLog.js';
import FeedPlayer from './FeedPlayer.jsx';
import './DetailView.scss';

export default function DetailView({ item, sections, ogImage, ogDescription, loading, onBack, onNext, onPrev, onPlay, activeMedia, playback, onNavigateToItem }) {
  const sourceName = item.meta?.sourceName || item.source || '';
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colorFromLabel(sourceName);
  const age = formatAge(item.timestamp);
  const heroImage = item.image || ogImage;
  const isYouTube = item.contentType === 'youtube' && item.meta?.videoId;
  const subtitle = isYouTube ? null : (item.body || ogDescription);
  const hasArticle = sections.length > 0 && !loading;
  const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imagePhase, setImagePhase] = useState('original'); // original → proxy → hidden
  const contentRef = useRef(null);
  const dirRef = useRef(0); // -1 = prev, 1 = next
  const titleAreaRef = useRef(null);
  const stickyRef = useRef(null);
  const stickyInitRef = useRef(true);
  const [stickyVisible, setStickyVisible] = useState(false);

  // Reset image state when hero image changes
  useEffect(() => {
    feedLog.image('detail hero reset', { heroImage, itemId: item.id });
    setImageLoaded(false);
    setImagePhase('original');
  }, [heroImage]);

  // Reset sticky header and scroll position on item change
  useEffect(() => {
    setStickyVisible(false);
    stickyInitRef.current = true;
    const el = stickyRef.current;
    if (el) {
      el.getAnimations().forEach(a => a.cancel());
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    }
    contentRef.current?.closest('.detail-modal-panel')?.scrollTo(0, 0);
  }, [item.id]);


  // IntersectionObserver for sticky header
  useEffect(() => {
    const el = titleAreaRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Animate sticky header visibility (Web Animations API for TV compat)
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    if (stickyInitRef.current) { stickyInitRef.current = false; return; }
    el.getAnimations().forEach(a => a.cancel());
    el.animate(
      [{ opacity: stickyVisible ? 0 : 1 }, { opacity: stickyVisible ? 1 : 0 }],
      { duration: 150, easing: 'ease-out', fill: 'forwards' }
    );
    el.style.pointerEvents = stickyVisible ? 'auto' : 'none';
  }, [stickyVisible]);

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

    if (dx < 0 && onNext) { feedLog.nav('detail swipe next', { dx }); navigateWithAnimation(1, onNext); }
    if (dx > 0 && onPrev) { feedLog.nav('detail swipe prev', { dx }); navigateWithAnimation(-1, onPrev); }
  }, [onNext, onPrev, navigateWithAnimation]);

  return (
    <div className="detail-view" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button className="detail-close" onClick={onBack} aria-label="Back to feed">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
      <div ref={stickyRef} className="detail-sticky-header" style={{ borderTop: `2px solid ${borderColor}` }}>
        <button className="detail-sticky-back" onClick={onBack} aria-label="Back to feed">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        {iconUrl && <img src={iconUrl} alt="" className="detail-sticky-icon" onError={(e) => { e.target.style.display = 'none'; }} />}
        <span className="detail-sticky-title">{item.title}</span>
      </div>
      <div className="detail-content-clip">
      <div ref={contentRef} className="detail-content">
        <div className="detail-source-bar" style={{ borderTop: `2px solid ${borderColor}` }}>
          {iconUrl && <img src={iconUrl} alt="" className="detail-source-icon" onError={(e) => { e.target.style.display = 'none'; }} />}
          <span className="detail-source-label">{sourceName}</span>
          <span className="detail-source-age">{age}</span>
        </div>

        {isYouTube ? (
          <YouTubeHero
            item={item}
            heroImage={heroImage}
            sections={sections}
            onPlay={onPlay}
          />
        ) : heroImage && imagePhase !== 'hidden' && !sections.some(s => s.type === 'player' || s.type === 'embed') && (() => {
          const isPortrait = item.meta?.imageHeight > item.meta?.imageWidth;
          const imgSrc = imagePhase === 'proxy' ? (proxyImage(heroImage) || heroImage) : heroImage;
          return (
            <div className={`detail-hero${isPortrait ? ' detail-hero--portrait' : ''}`} style={{
              aspectRatio: imageLoaded
                ? undefined
                : (item.meta?.imageWidth && item.meta?.imageHeight)
                  ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
                  : '16 / 9',
            }}>
              {!imageLoaded && <div className="detail-hero-shimmer" />}
              <img
                src={imgSrc}
                alt=""
                onLoad={() => { feedLog.image('detail hero loaded', { src: imgSrc, phase: imagePhase }); setImageLoaded(true); }}
                onError={() => {
                  if (imagePhase === 'original' && proxyImage(heroImage)) {
                    feedLog.image('detail hero fallback to proxy', { original: heroImage, proxy: proxyImage(heroImage) });
                    setImagePhase('proxy');
                  } else {
                    feedLog.image('detail hero hidden — all sources failed', { heroImage, phase: imagePhase });
                    setImagePhase('hidden');
                  }
                }}
                style={imageLoaded ? undefined : { position: 'absolute', opacity: 0 }}
              />
            </div>
          );
        })()}

        <div ref={titleAreaRef} className="detail-title-area">
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
            {renderSection(section, { onPlay, activeMedia, playback, item, onNavigateToItem })}
          </div>
        ))}

      </div>
      </div>
    </div>
  );
}

function YouTubeHero({ item, heroImage, sections, onPlay: _onPlay }) {
  const [ytPlaying, setYtPlaying] = useState(false);
  const [useEmbed, setUseEmbed] = useState(false);

  // Reset on item change
  useEffect(() => {
    setYtPlaying(false);
    setUseEmbed(false);
  }, [item.id]);

  // Check if backend provided a native player section
  const playerSection = sections.find(
    s => s.type === 'player' && s.data?.provider === 'youtube'
  );
  const embedSection = sections.find(
    s => s.type === 'embed' && s.data?.provider === 'youtube'
  );
  const sectionsLoaded = sections.length > 0;
  const embedFallback = playerSection?.data?.embedFallback
    || embedSection?.data?.url
    || `https://www.youtube.com/embed/${item.meta.videoId}?autoplay=1&rel=0`;

  const handleStreamError = useCallback(() => {
    setUseEmbed(true);
  }, []);

  const aspectRatio = (item.meta?.imageWidth && item.meta?.imageHeight)
    ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
    : '16 / 9';

  // Not playing yet — show thumbnail + play button
  if (!ytPlaying) {
    return (
      <div className="detail-hero" style={{ aspectRatio }}>
        {heroImage && <img src={heroImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        <button
          onClick={() => setYtPlaying(true)}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
          aria-label="Play video"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
    );
  }

  // Sections still loading — show loading state, not iframe
  if (!sectionsLoaded) {
    return (
      <div className="detail-hero" style={{ aspectRatio }}>
        {heroImage && <img src={heroImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="scroll-loading-dots"><span /><span /><span /></div>
        </div>
      </div>
    );
  }

  // Playing: try native player, fall back to embed
  if (playerSection && !useEmbed) {
    const data = playerSection.data;
    if (data.videoUrl || data.url) {
      return (
        <FeedPlayer
          playerData={data}
          onError={handleStreamError}
          aspectRatio={aspectRatio}
        />
      );
    }
  }

  // Embed fallback (always works)
  return (
    <div className="detail-hero" style={{ aspectRatio }}>
      <iframe
        src={embedFallback}
        title={item.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
