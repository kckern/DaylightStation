import React, { useRef, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import './ImageFrame.scss';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'ImageFrame' });

const DISSOLVE_MS = 1000;

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

  useEffect(() => {
    logger.debug('image-frame-mount', { imageId });
    return () => logger.debug('image-frame-unmount', { imageId });
  }, []);

  // JIT fetch face data from /info/ endpoint for smart zoom
  useEffect(() => {
    if (!imageId) return;
    if (hasFaces) return;

    let cancelled = false;
    const fetchFaceData = async () => {
      try {
        const response = await fetch(`/api/v1/info/${encodeURIComponent(imageId)}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const infoPeople = data.metadata?.people;
        if (!cancelled && infoPeople?.length > 0) {
          const hasFaceData = infoPeople.some(p => p.faces?.length > 0);
          if (hasFaceData) {
            logger.debug('image-frame-jit-faces', {
              imageId,
              peopleCount: infoPeople.length,
              faceCount: infoPeople.reduce((n, p) => n + (p.faces?.length || 0), 0),
            });
            setEnrichment({ forId: imageId, people: infoPeople });
          }
        }
      } catch (err) {
        logger.warn('image-frame-jit-faces-error', { imageId, error: err.message });
      }
    };
    fetchFaceData();
    return () => { cancelled = true; };
  }, [imageId, hasFaces]);

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

  // Resilience bridge registration
  useEffect(() => {
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      const getActiveImg = () =>
        activeLayerRef.current === 'a' ? layerARef.current : layerBRef.current;
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl: getActiveImg,
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

  // Preload next image in queue
  useEffect(() => {
    if (!nextMedia?.thumbnail && !nextMedia?.mediaUrl) return;
    const preloader = new Image();
    preloader.src = nextMedia.thumbnail || nextMedia.mediaUrl;
    if (nextMedia.thumbnail && nextMedia.mediaUrl && nextMedia.thumbnail !== nextMedia.mediaUrl) {
      const origPreloader = new Image();
      origPreloader.src = nextMedia.mediaUrl;
    }
    logger.debug('image-frame-preload', { nextId: nextMedia.id });
  }, [nextMedia?.id]);

  // Main effect: handle image transitions (cross-dissolve + Ken Burns)
  useEffect(() => {
    if (!media?.mediaUrl) return;

    const currentId = media.id || media.mediaUrl;
    const isFirstImage = prevMediaIdRef.current === null;
    const mediaChanged = currentId !== prevMediaIdRef.current;

    if (!mediaChanged) return;
    prevMediaIdRef.current = currentId;
    expectedIdRef.current = currentId;

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

      // Cross-dissolve (skip on first image)
      if (!isFirstImage && outgoingImg) {
        incomingImg.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: DISSOLVE_MS, fill: 'forwards', easing: 'ease-in-out' }
        );
        outgoingImg.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: DISSOLVE_MS, fill: 'forwards', easing: 'ease-in-out' }
        );
        if (animationRefs.current[outgoingKey]) {
          animationRefs.current[outgoingKey].cancel();
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

      if (typeof resilienceBridge?.onStartupSignal === 'function') {
        resilienceBridge.onStartupSignal();
      }

      // Show metadata after dissolve settles
      if (slideshow.showMetadata) {
        const metaDelay = isFirstImage ? 500 : DISSOLVE_MS + 200;
        setTimeout(() => {
          if (expectedIdRef.current === currentId) {
            setSettledImageId(currentId);
          }
        }, metaDelay);
      }

      // Advance timer
      startTimeRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        logger.debug('image-frame-advance', { imageId: currentId, durationSec: duration / 1000 });
        if (typeof advance === 'function') advance();
      }, duration);

      // Playback metrics tick
      const tickMetrics = () => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (typeof resilienceBridge?.onPlaybackMetrics === 'function') {
          resilienceBridge.onPlaybackMetrics({ seconds: elapsed, isPaused: false, isSeeking: false });
        }
        rafRef.current = requestAnimationFrame(tickMetrics);
      };
      rafRef.current = requestAnimationFrame(tickMetrics);

      // Upgrade thumbnail → original
      if (thumbnailUrl !== originalUrl) {
        const original = new Image();
        original.onload = () => {
          if (expectedIdRef.current === currentId && activeLayerRef.current === incomingKey) {
            incomingImg.src = originalUrl;
            logger.debug('image-frame-upgraded-to-original', { imageId: currentId });
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
      if (typeof advance === 'function') advance();
    };
    incomingImg.src = thumbnailUrl;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [media?.id, media?.mediaUrl, duration, effect, zoom, advance, resilienceBridge, focusPerson, slideshow.showMetadata]);

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
    if (!slideshow.showMetadata || !media?.metadata) return null;
    const names = (media.metadata.people || []).map(p => p.name).filter(Boolean);
    const date = formatPhotoDate(media.metadata.capturedAt);
    const location = media.metadata.location || null;
    if (!names.length && !date && !location) return null;
    return { names, date, location };
  }, [slideshow.showMetadata, media?.metadata]);

  if (!media?.mediaUrl) {
    return <div className="image-frame image-frame--loading" />;
  }

  return (
    <div ref={containerRef} className="image-frame">
      <img ref={layerARef} className="image-frame__layer" draggable={false} alt="" />
      <img ref={layerBRef} className="image-frame__layer" draggable={false} alt="" />
      {settledImageId === imageId && metadataOverlay && (
        <div className="image-frame__metadata">
          {metadataOverlay.date && (
            <span className="image-frame__metadata-date">{metadataOverlay.date}</span>
          )}
          {metadataOverlay.names.length > 0 && (
            <span className="image-frame__metadata-people">{metadataOverlay.names.join(' \u00b7 ')}</span>
          )}
          {metadataOverlay.location && (
            <span className="image-frame__metadata-location">{metadataOverlay.location}</span>
          )}
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
