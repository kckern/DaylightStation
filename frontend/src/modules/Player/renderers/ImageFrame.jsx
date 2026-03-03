import React, { useRef, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import './ImageFrame.scss';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'ImageFrame' });

const DISSOLVE_MS = 1000;
// Frame budget at 60fps — frames longer than this are "long frames"
const LONG_FRAME_THRESHOLD_MS = 50;

/**
 * Compute Ken Burns animation target based on face data.
 * Priority: focusPerson face > center-most face > random center 60%
 */
export function computeZoomTarget({ people, focusPerson, zoom }) {
  const maxTranslate = ((zoom - 1) / zoom) * 50;

  let targetX = 0.5;
  let targetY = 0.5;
  let found = false;
  let strategy = 'random';

  const allFaces = (people || []).flatMap(p =>
    (p.faces || []).map(f => ({ ...f, personName: p.name }))
  );

  if (focusPerson && allFaces.length > 0) {
    const match = allFaces.find(f =>
      f.personName?.toLowerCase() === focusPerson.toLowerCase()
    );
    if (match && match.imageWidth && match.imageHeight) {
      targetX = ((match.x1 + match.x2) / 2) / match.imageWidth;
      targetY = ((match.y1 + match.y2) / 2) / match.imageHeight;
      found = true;
      strategy = 'focus-person';
    }
  }

  if (!found && allFaces.length > 0) {
    let closest = allFaces[0];
    let closestDist = Infinity;
    for (const f of allFaces) {
      if (!f.imageWidth || !f.imageHeight) continue;
      const cx = ((f.x1 + f.x2) / 2) / f.imageWidth;
      const cy = ((f.y1 + f.y2) / 2) / f.imageHeight;
      const dist = (cx - 0.5) ** 2 + (cy - 0.5) ** 2;
      if (dist < closestDist) {
        closestDist = dist;
        closest = f;
      }
    }
    if (closest.imageWidth && closest.imageHeight) {
      targetX = ((closest.x1 + closest.x2) / 2) / closest.imageWidth;
      targetY = ((closest.y1 + closest.y2) / 2) / closest.imageHeight;
      found = true;
      strategy = 'center-face';
    }
  }

  if (!found) {
    targetX = 0.2 + Math.random() * 0.6;
    targetY = 0.2 + Math.random() * 0.6;
  }

  logger.debug('zoom-target-computed', {
    strategy,
    focusPerson: focusPerson || null,
    faceCount: allFaces.length,
    faceNames: [...new Set(allFaces.map(f => f.personName).filter(Boolean))],
    targetX: targetX.toFixed(3),
    targetY: targetY.toFixed(3),
    zoom,
  });

  const startOffX = (0.5 - targetX) * maxTranslate * 0.3;
  const startOffY = (0.5 - targetY) * maxTranslate * 0.3;
  const endOffX = (0.5 - targetX) * maxTranslate;
  const endOffY = (0.5 - targetY) * maxTranslate;

  return {
    startX: `${startOffX.toFixed(2)}%`,
    startY: `${startOffY.toFixed(2)}%`,
    endX: `${endOffX.toFixed(2)}%`,
    endY: `${endOffY.toFixed(2)}%`,
    strategy,
  };
}

function formatPhotoDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return null;
  }
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const days = Math.floor(diffMs / 86400000);
    if (days < 1) return 'Today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30.44);
    if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
    const years = Math.floor(days / 365.25);
    const remMonths = Math.floor((days - years * 365.25) / 30.44);
    if (remMonths > 0) return `${years} year${years > 1 ? 's' : ''}, ${remMonths} month${remMonths > 1 ? 's' : ''} ago`;
    return years === 1 ? '1 year ago' : `${years} years ago`;
  } catch {
    return null;
  }
}

/**
 * ImageFrame — photo renderer with Ken Burns, cross-dissolve, and metadata overlay.
 *
 * Uses a dual-layer (A/B) architecture: when a new image arrives, it loads on
 * the inactive layer and cross-dissolves with the outgoing layer. Thumbnails
 * display immediately, then upgrade to originals in the background. The next
 * image in the queue is preloaded for instant transitions.
 */
export function ImageFrame({
  media,
  advance,
  clear,
  shader,
  resilienceBridge,
  ignoreKeys,
  nextMedia,
}) {
  const containerRef = useRef(null);
  const layerARef = useRef(null);
  const layerBRef = useRef(null);
  const activeLayerRef = useRef('a');
  const animationRefs = useRef({ a: null, b: null });
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);
  const prevMediaIdRef = useRef(null);
  const expectedIdRef = useRef(null);
  const pausedRef = useRef(false);
  const remainingRef = useRef(0);
  const metadataRef = useRef(null);
  const metaFadeRef = useRef(null);

  // Stable refs for callbacks — keeps them out of effect deps to prevent
  // unnecessary cleanup cycles that would clear the advance timer.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const resilienceBridgeRef = useRef(resilienceBridge);
  resilienceBridgeRef.current = resilienceBridge;

  // Enriched face data tracked with source ID to prevent stale cross-image leaks
  const [enrichment, setEnrichment] = useState({ forId: null, people: null });
  const [settledImageId, setSettledImageId] = useState(null);

  const imageId = media?.id || null;
  const slideshow = useMemo(() => media?.slideshow || {}, [media?.slideshow]);
  const duration = (slideshow.duration || 5) * 1000;
  const zoom = slideshow.zoom || 1.2;
  const effect = slideshow.effect || 'kenburns';
  const focusPerson = slideshow.focusPerson || null;
  const people = useMemo(() => media?.metadata?.people || [], [media?.metadata?.people]);
  const hasFaces = useMemo(() => people.some(p => p.faces?.length > 0), [people]);

  // ── Performance instrumentation ──────────────────────────────────────
  // Session logger persists to media/logs/slideshow/*.jsonl via backend.
  const perfLog = useMemo(
    () => getLogger().child({ component: 'ImageFrame', app: 'slideshow', sessionLog: true }),
    []
  );
  // Per-slide metrics accumulator — reset on each new slide
  const perfRef = useRef(null);

  /** Start collecting metrics for a new slide */
  const perfStart = (id, title) => {
    perfRef.current = {
      imageId: id,
      title,
      t0: performance.now(),           // effect start
      thumbLoadMs: null,                // time to first paint (thumbnail onload)
      origStartMs: null,                // when original fetch begins (relative to t0)
      origLoadMs: null,                 // when original finishes (relative to t0)
      upgradeDelayMs: null,             // time user sees thumbnail before original (origLoad - thumbLoad)
      preloadHit: false,                // was this image preloaded?
      longFrames: 0,                    // frames > LONG_FRAME_THRESHOLD_MS
      maxFrameMs: 0,                    // worst single frame
      totalFrames: 0,                   // total rAF ticks during display
      lastFrameTs: null,                // for delta computation
    };
  };

  /** Record a rAF tick — called every frame during display */
  const perfTick = (now) => {
    const p = perfRef.current;
    if (!p) return;
    p.totalFrames++;
    if (p.lastFrameTs !== null) {
      const delta = now - p.lastFrameTs;
      if (delta > p.maxFrameMs) p.maxFrameMs = delta;
      if (delta > LONG_FRAME_THRESHOLD_MS) p.longFrames++;
    }
    p.lastFrameTs = now;
  };

  /** Flush per-slide summary to the session log */
  const perfFlush = () => {
    const p = perfRef.current;
    if (!p) return;
    perfRef.current = null;

    const displayMs = performance.now() - p.t0;
    perfLog.info('slideshow.slide-summary', {
      imageId: p.imageId,
      title: p.title,
      displayMs: Math.round(displayMs),
      thumbLoadMs: p.thumbLoadMs != null ? Math.round(p.thumbLoadMs) : null,
      origLoadMs: p.origLoadMs != null ? Math.round(p.origLoadMs) : null,
      upgradeDelayMs: p.upgradeDelayMs != null ? Math.round(p.upgradeDelayMs) : null,
      preloadHit: p.preloadHit,
      totalFrames: p.totalFrames,
      longFrames: p.longFrames,
      maxFrameMs: Math.round(p.maxFrameMs),
      avgFps: p.totalFrames > 1 ? Math.round(p.totalFrames / (displayMs / 1000)) : null,
    });
  };
  // ── End performance instrumentation ──────────────────────────────────

  useEffect(() => {
    logger.debug('image-frame-mount', { imageId });
    return () => {
      // Flush any in-progress slide metrics on unmount
      perfFlush();
      logger.debug('image-frame-unmount', { imageId });
    };
  }, []);

  // JIT fetch metadata from /info/ endpoint for smart zoom + overlay
  useEffect(() => {
    if (!imageId) return;

    let cancelled = false;
    const fetchMetadata = async () => {
      try {
        const response = await fetch(`/api/v1/info/${encodeURIComponent(imageId)}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (cancelled) return;
        const meta = data.metadata || {};
        logger.debug('image-frame-jit-metadata', {
          imageId,
          peopleCount: meta.people?.length || 0,
          hasCapturedAt: !!meta.capturedAt,
          hasLocation: !!meta.location,
        });
        setEnrichment({
          forId: imageId,
          people: meta.people?.length > 0 ? meta.people : null,
          capturedAt: meta.capturedAt || null,
          location: meta.location || null,
        });
      } catch (err) {
        logger.warn('image-frame-jit-metadata-error', { imageId, error: err.message });
      }
    };
    fetchMetadata();
    return () => { cancelled = true; };
  }, [imageId]);

  // Only use enriched data if it belongs to the current image
  const effectivePeople = useMemo(
    () => (enrichment.forId === imageId ? enrichment.people : null) || people,
    [enrichment, imageId, people]
  );

  const zoomTarget = useMemo(
    () => computeZoomTarget({ people: effectivePeople, focusPerson, zoom }),
    [effectivePeople, focusPerson, zoom]
  );
  const zoomTargetRef = useRef(zoomTarget);
  zoomTargetRef.current = zoomTarget;

  // Resilience bridge registration — exposes a mock media element so the
  // Player's pause/play imperative calls work for the image slideshow.
  useEffect(() => {
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      const mockMediaEl = {
        get paused() { return pausedRef.current; },
        pause: () => {
          if (pausedRef.current) return;
          pausedRef.current = true;
          // Freeze advance timer
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
            remainingRef.current = Math.max(0,
              (startTimeRef.current ? (startTimeRef.current + remainingRef.current) - Date.now() : 0)
            );
          }
          // Freeze Ken Burns and RAF
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          const activeAnim = animationRefs.current[activeLayerRef.current];
          if (activeAnim) activeAnim.pause();
          logger.debug('image-frame-pause', { imageId: expectedIdRef.current });
        },
        play: () => {
          if (!pausedRef.current) return Promise.resolve();
          pausedRef.current = false;
          // Resume Ken Burns
          const activeAnim = animationRefs.current[activeLayerRef.current];
          if (activeAnim) activeAnim.play();
          // Resume advance timer for remaining duration
          const remaining = remainingRef.current;
          if (remaining > 0) {
            startTimeRef.current = Date.now();
            timerRef.current = setTimeout(() => {
              logger.debug('image-frame-advance', { imageId: expectedIdRef.current, durationSec: remaining / 1000 });
              advanceRef.current?.();
            }, remaining);
          }
          // Resume metrics tick
          const tickMetrics = (now) => {
            perfTick(now);
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            if (typeof resilienceBridgeRef.current?.onPlaybackMetrics === 'function') {
              resilienceBridgeRef.current.onPlaybackMetrics({ seconds: elapsed, isPaused: false, isSeeking: false });
            }
            rafRef.current = requestAnimationFrame(tickMetrics);
          };
          rafRef.current = requestAnimationFrame(tickMetrics);
          logger.debug('image-frame-resume', { imageId: expectedIdRef.current, remaining });
          return Promise.resolve();
        },
        // Enough of the HTMLMediaElement interface to not break callers
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
        readyState: 4,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl: () => mockMediaEl,
        hardReset: () => {
          if (animationRefs.current.a) animationRefs.current.a.cancel();
          if (animationRefs.current.b) animationRefs.current.b.cancel();
        },
      });
    }
    return () => {
      if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
        resilienceBridge.onRegisterMediaAccess({});
      }
    };
  }, [resilienceBridge]);

  // Preload next image in queue — refs kept alive to prevent GC before load completes
  const preloadRef = useRef({ thumb: null, orig: null, thumbDone: false, origDone: false });
  useEffect(() => {
    if (!nextMedia?.thumbnail && !nextMedia?.mediaUrl) return;
    const thumbUrl = nextMedia.thumbnail || nextMedia.mediaUrl;
    const origUrl = nextMedia.mediaUrl;
    const t0 = performance.now();
    const thumbImg = new Image();
    thumbImg.onload = () => {
      preloadRef.current.thumbDone = true;
      perfLog.info('slideshow.preload-thumb', { nextId: nextMedia.id, ms: Math.round(performance.now() - t0) });
    };
    thumbImg.src = thumbUrl;
    preloadRef.current.thumb = thumbImg;
    preloadRef.current.thumbDone = false;
    preloadRef.current.origDone = false;
    if (origUrl && origUrl !== thumbUrl) {
      const origImg = new Image();
      origImg.onload = () => {
        preloadRef.current.origDone = true;
        perfLog.info('slideshow.preload-orig', { nextId: nextMedia.id, ms: Math.round(performance.now() - t0) });
      };
      origImg.src = origUrl;
      preloadRef.current.orig = origImg;
    } else {
      preloadRef.current.origDone = true; // same URL, no separate original
    }
    logger.debug('image-frame-preload-start', { nextId: nextMedia.id });
    return () => { preloadRef.current = { thumb: null, orig: null, thumbDone: false, origDone: false }; };
  }, [nextMedia?.id]);

  // Main effect: handle image transitions (cross-dissolve + Ken Burns)
  useEffect(() => {
    if (!media?.mediaUrl) return;

    const currentId = media.id || media.mediaUrl;
    const isFirstImage = prevMediaIdRef.current === null;
    const mediaChanged = currentId !== prevMediaIdRef.current;

    if (!mediaChanged) return;

    // Flush metrics from previous slide before starting new one
    perfFlush();

    prevMediaIdRef.current = currentId;
    expectedIdRef.current = currentId;

    // Start perf collection for this slide
    perfStart(currentId, media.title);
    const p = perfRef.current;

    // Clear previous cycle
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setSettledImageId(null);

    const outgoingKey = activeLayerRef.current;
    const incomingKey = outgoingKey === 'a' ? 'b' : 'a';
    const outgoingImg = outgoingKey === 'a' ? layerARef.current : layerBRef.current;
    const incomingImg = incomingKey === 'a' ? layerARef.current : layerBRef.current;

    if (!incomingImg) return;

    const thumbnailUrl = media.thumbnail || media.mediaUrl;
    const originalUrl = media.mediaUrl;
    const zt = zoomTargetRef.current;

    logger.info('image-frame-start', {
      imageId: currentId,
      title: media.title,
      duration: duration / 1000,
      effect,
      zoom,
      focusPerson,
      zoomStrategy: zt.strategy,
      isFirstImage,
      transition: isFirstImage ? 'none' : 'crossfade',
    });

    const onIncomingLoad = () => {
      // Guard against stale loads from a previous image
      if (expectedIdRef.current !== currentId) return;

      // Record thumbnail load time
      if (p && p.thumbLoadMs === null) {
        p.thumbLoadMs = performance.now() - p.t0;
        // A load under 10ms means the browser served from cache (preload worked)
        p.preloadHit = p.thumbLoadMs < 10;
        perfLog.info('slideshow.thumb-loaded', {
          imageId: currentId,
          ms: Math.round(p.thumbLoadMs),
          preloadHit: p.preloadHit,
        });
      }

      // Prevent re-entry: the thumbnail→original upgrade changes src, which
      // would re-fire onload and create duplicate advance timers.
      incomingImg.onload = null;

      // Cross-dissolve (skip on first image)
      if (!isFirstImage && outgoingImg) {
        incomingImg.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: DISSOLVE_MS, fill: 'forwards', easing: 'ease-in-out' }
        );
        const outFade = outgoingImg.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: DISSOLVE_MS, fill: 'forwards', easing: 'ease-in-out' }
        );
        // Let the outgoing Ken Burns continue during dissolve so it doesn't
        // snap back to its init position (visual jolt). Cancel only after
        // the fade-out completes when the layer is invisible.
        const outgoingAnim = animationRefs.current[outgoingKey];
        if (outgoingAnim) {
          outFade.onfinish = () => outgoingAnim.cancel();
        }
      }

      // Ken Burns on incoming layer
      if (effect === 'kenburns') {
        animationRefs.current[incomingKey] = incomingImg.animate([
          { transform: `scale(1.0) translate(${zt.startX}, ${zt.startY})` },
          { transform: `scale(${zoom}) translate(${zt.endX}, ${zt.endY})` },
        ], {
          duration,
          easing: 'ease-in-out',
          fill: 'forwards',
        });
      }

      activeLayerRef.current = incomingKey;

      if (typeof resilienceBridgeRef.current?.onStartupSignal === 'function') {
        resilienceBridgeRef.current.onStartupSignal();
      }

      // Show metadata after dissolve settles, fade out before advance
      if (slideshow.showMetadata) {
        const metaDelay = isFirstImage ? 500 : DISSOLVE_MS + 200;
        const FADE_IN_MS = 600;
        const FADE_OUT_MS = 800;
        setTimeout(() => {
          if (expectedIdRef.current !== currentId) return;
          setSettledImageId(currentId);
          // Fade-in via Web Animations API (TVApp kills CSS transitions)
          requestAnimationFrame(() => {
            if (metadataRef.current && expectedIdRef.current === currentId) {
              metaFadeRef.current = metadataRef.current.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                { duration: FADE_IN_MS, fill: 'forwards', easing: 'ease-in' }
              );
            }
          });
        }, metaDelay);
        // Schedule fade-out before advance
        const fadeOutAt = duration - FADE_OUT_MS - 200;
        if (fadeOutAt > metaDelay + FADE_IN_MS) {
          setTimeout(() => {
            if (expectedIdRef.current !== currentId) return;
            if (metadataRef.current) {
              metaFadeRef.current = metadataRef.current.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                { duration: FADE_OUT_MS, fill: 'forwards', easing: 'ease-out' }
              );
            }
          }, fadeOutAt);
        }
      }

      // Advance timer
      pausedRef.current = false;
      remainingRef.current = duration;
      startTimeRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        logger.debug('image-frame-advance', { imageId: currentId, durationSec: duration / 1000 });
        advanceRef.current?.();
      }, duration);

      // Playback metrics tick — also drives jank detection via perfTick
      const tickMetrics = (now) => {
        perfTick(now);
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (typeof resilienceBridgeRef.current?.onPlaybackMetrics === 'function') {
          resilienceBridgeRef.current.onPlaybackMetrics({ seconds: elapsed, isPaused: pausedRef.current, isSeeking: false });
        }
        rafRef.current = requestAnimationFrame(tickMetrics);
      };
      rafRef.current = requestAnimationFrame(tickMetrics);

      // Upgrade thumbnail → original
      if (thumbnailUrl !== originalUrl) {
        if (p) p.origStartMs = performance.now() - p.t0;
        const original = new Image();
        original.onload = () => {
          if (expectedIdRef.current === currentId && activeLayerRef.current === incomingKey) {
            incomingImg.src = originalUrl;
            if (p) {
              p.origLoadMs = performance.now() - p.t0;
              p.upgradeDelayMs = p.origLoadMs - (p.thumbLoadMs || 0);
              perfLog.info('slideshow.original-loaded', {
                imageId: currentId,
                origLoadMs: Math.round(p.origLoadMs),
                upgradeDelayMs: Math.round(p.upgradeDelayMs),
              });
            }
          }
        };
        original.src = originalUrl;
      }
    };

    // Prepare incoming layer
    incomingImg.style.opacity = isFirstImage ? '1' : '0';
    incomingImg.onload = onIncomingLoad;
    incomingImg.onerror = () => {
      logger.warn('image-frame-load-error', { imageId: currentId, mediaUrl: thumbnailUrl });
      advanceRef.current?.();
    };
    incomingImg.src = thumbnailUrl;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [media?.id, media?.mediaUrl, duration, effect, zoom, focusPerson, slideshow.showMetadata]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRefs.current.a) animationRefs.current.a.cancel();
      if (animationRefs.current.b) animationRefs.current.b.cancel();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const metadataOverlay = useMemo(() => {
    if (!slideshow.showMetadata) return null;
    const enrichedForThis = enrichment.forId === imageId ? enrichment : null;
    const rawDate = enrichedForThis?.capturedAt || media?.metadata?.capturedAt;
    const names = (enrichedForThis?.people || media?.metadata?.people || []).map(p => p.name).filter(Boolean);
    const date = formatPhotoDate(rawDate);
    const timeAgo = formatTimeAgo(rawDate);
    const location = enrichedForThis?.location || media?.metadata?.location || null;
    if (!names.length && !date && !location) return null;
    return { names, date, timeAgo, location };
  }, [slideshow.showMetadata, media?.metadata, enrichment, imageId]);

  if (!media?.mediaUrl) {
    return <div className="image-frame image-frame--loading" />;
  }

  return (
    <div ref={containerRef} className="image-frame">
      <img ref={layerARef} className="image-frame__layer" draggable={false} alt="" />
      <img ref={layerBRef} className="image-frame__layer" draggable={false} alt="" />
      {settledImageId === imageId && metadataOverlay && (
        <div ref={metadataRef} className="image-frame__metadata" style={{ opacity: 0 }}>
          <div className="image-frame__metadata-backdrop" />
          <div className="image-frame__metadata-content">
            {metadataOverlay.date && (
              <span className="image-frame__metadata-date">
                {metadataOverlay.date}
                {metadataOverlay.timeAgo && (
                  <span className="image-frame__metadata-ago">{metadataOverlay.timeAgo}</span>
                )}
              </span>
            )}
            {metadataOverlay.names.length > 0 && (
              <span className="image-frame__metadata-people">{metadataOverlay.names.join(' \u00b7 ')}</span>
            )}
            {metadataOverlay.location && (
              <span className="image-frame__metadata-location">{metadataOverlay.location}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

ImageFrame.propTypes = {
  media: PropTypes.object.isRequired,
  advance: PropTypes.func.isRequired,
  clear: PropTypes.func,
  shader: PropTypes.string,
  resilienceBridge: PropTypes.shape({
    onPlaybackMetrics: PropTypes.func,
    onRegisterMediaAccess: PropTypes.func,
    onStartupSignal: PropTypes.func,
  }),
  ignoreKeys: PropTypes.bool,
  nextMedia: PropTypes.object,
};
