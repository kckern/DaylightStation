import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { getReducedMotionQuery } from '@/lib/ui/browserMotion.js';
import { useDismissLayer } from '@/lib/ui/dismiss/useDismissLayer.js';
import { StateMessage } from '@/lib/ui/states.jsx';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { formatAge, proxyIcon, proxyImage, colorFromLabel, safeImage } from "../cards/utils.js";
import { renderSection } from "./sections/index.jsx";
import { feedLog } from "../feedLog.js";
import FeedPlayer from "../../players/FeedPlayer.jsx";
import FeedLoadingIndicator from "../../FeedLoadingIndicator.jsx";
import AnnotationPanel from "../../Annotations/AnnotationPanel.jsx";
import OfflineEditionButton from "../../offline/OfflineEditionButton.jsx";
import { webLink, frameableLink } from "../../../shared/webLink.mjs";
import "./DetailView.scss";

export default function DetailView({ renderDialog, focusOnEntry = false, item, sections, detailActions, ogImage, ogDescription, loading, error, onRetry, onBack, onNext, onPrev, onPlay, activeMedia, playback, onNavigateToItem, onStateAction }) {
  const inModal = Boolean(renderDialog);
  const usesDismissStack = useDismissLayer(!inModal, onBack);
  const sourceName = item.meta?.sourceName || item.source || '';
  const iconUrl = proxyIcon(item.meta?.sourceIcon);
  const borderColor = colorFromLabel(sourceName);
  const timestampDate = item.timestamp == null || item.timestamp === '' ? null : new Date(item.timestamp);
  const validTimestamp = timestampDate && Number.isFinite(timestampDate.getTime()) ? timestampDate : null;
  const age = validTimestamp ? formatAge(validTimestamp) : null;
  const heroImage = safeImage(item.image) || safeImage(ogImage);
  const isYouTube = item.contentType === 'youtube' && item.meta?.videoId;
  const subtitle = isYouTube ? null : (item.body || ogDescription);
  const hasArticle = sections.length > 0 && !loading;
  const CONTENT_TYPES = new Set(['body', 'article', 'player', 'embed', 'gallery', 'media', 'comments', 'scripture', 'timeline']);
  const hasContentSections = hasArticle && sections.some(s => CONTENT_TYPES.has(s.type));
  // Feed links are other people's data: only absolute http(s) URLs become an
  // anchor, and only ones off this app's origin fill the scripts+same-origin
  // sandboxed iframe. Anything else is shown as plain text.
  const rawOpenUrl = item.link && item.meta?.paywall && item.meta?.paywallProxy ? item.meta.paywallProxy + item.link : item.link;
  const openUrl = webLink(rawOpenUrl);
  const iframeSrc = frameableLink(rawOpenUrl, typeof window !== 'undefined' ? window.location.origin : '');
  const showIframe = !loading && !hasContentSections && !!iframeSrc && !isYouTube;
  const dateStr = validTimestamp?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) ?? null;

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imagePhase, setImagePhase] = useState('original'); // original → proxy → hidden
  const contentRef = useRef(null);
  const backRef = useRef(null);
  const stickyBackRef = useRef(null);
  const backFocusToRestore = useRef(null);
  const dirRef = useRef(0); // -1 = prev, 1 = next
  const stickyRef = useRef(null);
  const stickyInitRef = useRef(true);
  const articleTransitionRef = useRef(null);
  const heroLoadStartRef = useRef(performance.now());
  const [stickyVisible, setStickyVisible] = useState(false);

  const cancelArticleTransition = useCallback(() => {
    const animation = articleTransitionRef.current;
    articleTransitionRef.current = null;
    if (!animation) return;
    animation.onfinish = null;
    animation.cancel();
  }, []);

  useLayoutEffect(() => cancelArticleTransition, [cancelArticleTransition, item.id]);

  const updateStickyVisibility = useCallback(visible => {
    const outgoing = visible ? backRef.current : stickyBackRef.current;
    if (outgoing && document.activeElement === outgoing) backFocusToRestore.current = outgoing;
    setStickyVisible(visible);
  }, []);

  useLayoutEffect(() => {
    const previous = backFocusToRestore.current;
    backFocusToRestore.current = null;
    const active = document.activeElement;
    if (previous && (active === previous || active === document.body)) {
      (stickyVisible ? stickyBackRef : backRef).current?.focus({ preventScroll: true });
    }
  }, [stickyVisible]);

  useLayoutEffect(() => {
    if (!focusOnEntry) return;
    const focused = document.activeElement;
    if (focused === document.body || !focused?.getClientRects().length) {
      backRef.current?.focus({ preventScroll: true });
    }
  }, [focusOnEntry]);

  // Reset image state when hero image changes
  useEffect(() => {
    feedLog.image('detail hero reset', { heroImage, feedItemId: item.id });
    setImageLoaded(false);
    setImagePhase('original');
    heroLoadStartRef.current = performance.now();
  }, [heroImage, item.id]);

  // Reset sticky header and scroll position on item change
  useEffect(() => {
    updateStickyVisibility(false);
    stickyInitRef.current = true;
    const el = stickyRef.current;
    if (el) {
      el.getAnimations().forEach(a => a.cancel());
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    }
    contentRef.current?.closest('.detail-modal-panel')?.scrollTo(0, 0);
  }, [item.id, updateStickyVisibility]);


  // Hand Back to the sticky toolbar before the top target leaves the scrollport.
  // IntersectionObserver measures its box even while CSS hides the control.
  useEffect(() => {
    const el = backRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => updateStickyVisibility(entry.intersectionRatio < 1),
      { threshold: 1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateStickyVisibility]);

  // Animate sticky header visibility (Web Animations API for TV compat)
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    if (stickyInitRef.current) { stickyInitRef.current = false; return; }
    feedLog.nav(stickyVisible ? 'sticky-visible' : 'sticky-hidden', { id: item.id });
    el.getAnimations().forEach(a => a.cancel());
    if (getReducedMotionQuery(window)?.matches) {
      el.style.opacity = stickyVisible ? '1' : '0';
      el.style.pointerEvents = stickyVisible ? 'auto' : 'none';
      return;
    }
    el.animate(
      [{ opacity: stickyVisible ? 0 : 1 }, { opacity: stickyVisible ? 1 : 0 }],
      { duration: 150, easing: 'ease-out', fill: 'forwards' }
    );
    el.style.pointerEvents = stickyVisible ? 'auto' : 'none';
  }, [item.id, stickyVisible]);

  // Slide-in animation when item changes (Web Animations API for TV compat)
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !dirRef.current) return;
    if (getReducedMotionQuery(window)?.matches) {
      dirRef.current = 0;
      return;
    }
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
    if (articleTransitionRef.current) return;
    if (getReducedMotionQuery(window)?.matches) {
      dirRef.current = 0;
      handler();
      return;
    }
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
    articleTransitionRef.current = anim;
    anim.onfinish = () => {
      if (articleTransitionRef.current !== anim) return;
      cancelArticleTransition();
      handler();
    };
  }, [cancelArticleTransition]);

  useEffect(() => {
    if (inModal || usesDismissStack) return undefined;
    const handleEscape = event => {
      if (event.key === 'Escape' && !event.defaultPrevented) onBack();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [inModal, usesDismissStack, onBack]);

  const handleArticleArrows = event => {
    const { key, target, currentTarget } = event;
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    if (!currentTarget.contains(target) || target.isContentEditable ||
      target.closest?.('input, textarea, select, [role="textbox"], [role="slider"]')) return;
    const changeArticle = key === 'ArrowLeft' ? onPrev : onNext;
    if (!changeArticle) return;
    event.preventDefault();
    navigateWithAnimation(key === 'ArrowLeft' ? -1 : 1, changeArticle);
  };

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

  const article = (
    <div className="detail-view" onKeyDown={inModal ? undefined : handleArticleArrows} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button type="button" ref={backRef} className="detail-close ds-touch-target" onClick={onBack} aria-label="Back to feed"
        aria-hidden={stickyVisible || undefined} data-autofocus={inModal && !stickyVisible || undefined}>
        <UiIcon name="back" size={20} />
      </button>
      <div ref={stickyRef} className="detail-sticky-header" aria-hidden={!stickyVisible || undefined} style={{ borderTop: `2px solid ${borderColor}` }}>
        <button type="button" ref={stickyBackRef} className="detail-sticky-back ds-touch-target" onClick={onBack}
          aria-label="Back to feed" tabIndex={stickyVisible ? undefined : -1} data-autofocus={inModal && stickyVisible || undefined}>
          <UiIcon name="back" size={18} />
        </button>
        {iconUrl && <img key={iconUrl} src={iconUrl} alt="" className="detail-sticky-icon" onError={(e) => { e.target.style.display = 'none'; }} />}
        <span className="detail-sticky-title">{item.title}</span>
      </div>
      <div className="detail-content-clip">
      <div ref={contentRef} className="detail-content">
        <div className="detail-source-bar" style={{ borderTop: `2px solid ${borderColor}` }}>
          {iconUrl && <img key={iconUrl} src={iconUrl} alt="" className="detail-source-icon" onError={(e) => { e.target.style.display = 'none'; }} />}
          <span className="detail-source-label">{sourceName}</span>
          {age && <span className="detail-source-age">{age}</span>}
        </div>

        {isYouTube ? (
          <YouTubeHero
            item={item}
            heroImage={heroImage}
            sections={sections}
            loading={loading}
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
                onLoad={() => {
                  const durationMs = Math.round(performance.now() - heroLoadStartRef.current);
                  feedLog.image('detail hero loaded', { src: imgSrc, phase: imagePhase, durationMs });
                  feedLog.timing('detail-hero-image', { phase: imagePhase, durationMs, src: imgSrc });
                  setImageLoaded(true);
                }}
                onError={() => {
                  const durationMs = Math.round(performance.now() - heroLoadStartRef.current);
                  if (imagePhase === 'original' && proxyImage(heroImage)) {
                    feedLog.image('detail hero fallback to proxy', { original: heroImage, proxy: proxyImage(heroImage), durationMs });
                    setImagePhase('proxy');
                    heroLoadStartRef.current = performance.now();
                  } else {
                    feedLog.image('detail hero hidden', { heroImage, phase: imagePhase, durationMs });
                    setImagePhase('hidden');
                  }
                }}
                style={imageLoaded ? undefined : { position: 'absolute', opacity: 0 }}
              />
            </div>
          );
        })()}

        <div className="detail-title-area">
          <h2 className="detail-title">{item.title}</h2>
          {dateStr && <span className="detail-date">{dateStr}</span>}
          {!hasArticle && subtitle && <p className="detail-subtitle">{subtitle}</p>}
          <div className="detail-state-actions">
            <button type="button" aria-pressed={!!item.state?.isSaved} onClick={() => onStateAction?.(item.state?.isSaved ? 'unsave' : 'save')}>{item.state?.isSaved ? 'Saved' : 'Save'}</button>
            <button type="button" onClick={() => onStateAction?.(item.state?.isArchived ? 'unarchive' : 'archive')}>{item.state?.isArchived ? 'Restore' : 'Archive'}</button>
            <button type="button" onClick={() => onStateAction?.((item.state?.isRead ?? item.isRead) ? 'unread' : 'read')}>{(item.state?.isRead ?? item.isRead) ? 'Mark unread' : 'Mark read'}</button>
            <OfflineEditionButton item={item} detail={{ sections, ogImage, ogDescription }} />
          </div>
          {item.link && !openUrl && <span className="detail-link-text">{item.link}</span>}
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="detail-open-link"
              onClick={() => {
                feedLog.interaction('external-link', {
                  id: item.id,
                  title: item.title,
                  source: item.source,
                  url: item.link,
                  paywall: !!item.meta?.paywall,
                });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
              </svg>
              {item.meta?.paywall ? 'Open via archive' : 'Open in browser'}
            </a>
          )}
        </div>

        {loading && (
          <div className="detail-loading">
            <StateMessage state="loading" role="status" title="Loading article details…" />
          </div>
        )}

        {!loading && error && (
          <div className="detail-error" role="alert">
            <p>{error}</p>
            {onRetry && <button type="button" onClick={onRetry}>Try reader view again</button>}
          </div>
        )}

        {!loading && sections.map((section, i) => (
          <div key={i} className="detail-section">
            {renderSection(section, { onPlay, activeMedia, playback, item, onNavigateToItem, detailActions })}
          </div>
        ))}

        {showIframe && (
          <div className="detail-iframe-wrap">
            <p className="detail-iframe-note">If the publisher blocks the embedded page, use the original-link action above.</p>
            <iframe
              src={iframeSrc}
              title={item.title}
              className="detail-iframe"
              sandbox="allow-scripts allow-same-origin allow-popups"
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={() => feedLog.detail('iframe loaded', { id: item.id, src: iframeSrc })}
            />
          </div>
        )}

        <AnnotationPanel item={item} />

        {!inModal && (onPrev || onNext) && <nav className="detail-mobile-nav" aria-label="Article navigation">
          <button type="button" onClick={() => navigateWithAnimation(-1, onPrev)} disabled={!onPrev}>Previous</button>
          <button type="button" onClick={() => navigateWithAnimation(1, onNext)} disabled={!onNext}>Next</button>
        </nav>}

      </div>
      </div>
    </div>
  );
  return renderDialog ? renderDialog(article, handleArticleArrows) : article;
}

function YouTubeHero({ item, heroImage, sections, loading, onPlay: _onPlay }) {
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
  const embedFallback = playerSection?.data?.embedFallback
    || embedSection?.data?.url
    || `https://www.youtube.com/embed/${item.meta.videoId}?autoplay=1&rel=0`;

  const handleStreamError = useCallback(() => {
    feedLog.resolution('detail-embed-fallback', { videoId: item.meta?.videoId, reason: 'stream-error' });
    setUseEmbed(true);
  }, [item.meta?.videoId]);

  const aspectRatio = (item.meta?.imageWidth && item.meta?.imageHeight)
    ? `${item.meta.imageWidth} / ${item.meta.imageHeight}`
    : '16 / 9';

  // Not playing yet — show thumbnail + play button
  if (!ytPlaying) {
    return (
      <div className="detail-hero" style={{ aspectRatio }}>
        {heroImage && <img src={heroImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        <button
          onClick={() => {
            feedLog.interaction('youtube-play', { id: item.id, videoId: item.meta?.videoId });
            setYtPlaying(true);
          }}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
          }}
          aria-label="Play video"
        >
          <UiIcon name="play" size={28} style={{ color: '#fff' }} />
        </button>
      </div>
    );
  }

  // Sections still loading — show loading state, not iframe
  if (loading) {
    return (
      <div className="detail-hero" style={{ aspectRatio }}>
        {heroImage && <img src={heroImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FeedLoadingIndicator label="Loading video…" />
        </div>
      </div>
    );
  }

  // Playing: try native player, fall back to embed
  if (playerSection && !useEmbed) {
    const data = playerSection.data;
    if (data.videoUrl || data.url) {
      feedLog.resolution('detail-native-render', {
        videoId: item.meta?.videoId,
        mode: (data.videoUrl && data.audioUrl) ? 'split' : 'combined',
      });
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
  feedLog.resolution('detail-embed-render', { videoId: item.meta?.videoId, useEmbed, hasPlayerSection: !!playerSection });
  return (
    <div className="detail-hero" style={{ aspectRatio }}>
      <iframe
        src={embedFallback}
        title={item.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
