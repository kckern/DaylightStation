import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import './ImageFrame.scss';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'ImageFrame' });

/**
 * Compute Ken Burns animation target based on face data.
 * Priority: focusPerson face > largest face > random center 60%
 */
function computeZoomTarget({ people, focusPerson, zoom }) {
  const maxTranslate = ((zoom - 1) / zoom) * 50;

  let targetX = 0.5;
  let targetY = 0.5;
  let found = false;

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
    }
  }

  if (!found && allFaces.length > 0) {
    let largest = allFaces[0];
    let largestArea = 0;
    for (const f of allFaces) {
      const area = Math.abs((f.x2 - f.x1) * (f.y2 - f.y1));
      if (area > largestArea) {
        largestArea = area;
        largest = f;
      }
    }
    if (largest.imageWidth && largest.imageHeight) {
      targetX = ((largest.x1 + largest.x2) / 2) / largest.imageWidth;
      targetY = ((largest.y1 + largest.y2) / 2) / largest.imageHeight;
      found = true;
    }
  }

  if (!found) {
    targetX = 0.2 + Math.random() * 0.6;
    targetY = 0.2 + Math.random() * 0.6;
  }

  const startOffX = (0.5 - targetX) * maxTranslate * 0.3;
  const startOffY = (0.5 - targetY) * maxTranslate * 0.3;
  const endOffX = (0.5 - targetX) * maxTranslate;
  const endOffY = (0.5 - targetY) * maxTranslate;

  return {
    startX: `${startOffX.toFixed(2)}%`,
    startY: `${startOffY.toFixed(2)}%`,
    endX: `${endOffX.toFixed(2)}%`,
    endY: `${endOffY.toFixed(2)}%`,
  };
}

/**
 * ImageFrame — single photo renderer with Ken Burns effect.
 * Implements the same callback contract as VideoPlayer/AudioPlayer.
 */
export function ImageFrame({
  media,
  advance,
  clear,
  shader,
  resilienceBridge,
  ignoreKeys,
}) {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const slideshow = media?.slideshow || {};
  const duration = (slideshow.duration || 5) * 1000;
  const zoom = slideshow.zoom || 1.2;
  const effect = slideshow.effect || 'kenburns';
  const focusPerson = slideshow.focusPerson || null;
  const people = media?.metadata?.people || [];

  const zoomTarget = useMemo(
    () => computeZoomTarget({ people, focusPerson, zoom }),
    [people, focusPerson, zoom]
  );

  useEffect(() => {
    if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
      resilienceBridge.onRegisterMediaAccess({
        getMediaEl: () => imgRef.current,
        hardReset: () => {
          if (animationRef.current) animationRef.current.cancel();
        },
      });
    }
    return () => {
      if (typeof resilienceBridge?.onRegisterMediaAccess === 'function') {
        resilienceBridge.onRegisterMediaAccess({});
      }
    };
  }, [resilienceBridge]);

  useEffect(() => {
    if (!loaded || !imgRef.current) return;

    logger.info('image-frame-start', {
      mediaUrl: media?.mediaUrl,
      duration: duration / 1000,
      effect,
      zoom,
      focusPerson,
    });

    if (typeof resilienceBridge?.onStartupSignal === 'function') {
      resilienceBridge.onStartupSignal();
    }

    if (effect === 'kenburns') {
      animationRef.current = imgRef.current.animate([
        { transform: `scale(1.0) translate(${zoomTarget.startX}, ${zoomTarget.startY})` },
        { transform: `scale(${zoom}) translate(${zoomTarget.endX}, ${zoomTarget.endY})` },
      ], {
        duration,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
    }

    startTimeRef.current = Date.now();
    const tickMetrics = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (typeof resilienceBridge?.onPlaybackMetrics === 'function') {
        resilienceBridge.onPlaybackMetrics({
          seconds: elapsed,
          isPaused: false,
          isSeeking: false,
        });
      }
      rafRef.current = requestAnimationFrame(tickMetrics);
    };
    rafRef.current = requestAnimationFrame(tickMetrics);

    timerRef.current = setTimeout(() => {
      logger.debug('image-frame-advance', { mediaUrl: media?.mediaUrl });
      if (typeof advance === 'function') advance();
    }, duration);

    return () => {
      if (animationRef.current) animationRef.current.cancel();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [loaded, media?.mediaUrl, duration, effect, zoom, zoomTarget, advance, resilienceBridge, focusPerson]);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => {
    logger.warn('image-frame-load-error', { mediaUrl: media?.mediaUrl });
    if (typeof advance === 'function') advance();
  }, [advance, media?.mediaUrl]);

  if (!media?.mediaUrl) {
    return <div className="image-frame image-frame--loading" />;
  }

  return (
    <div ref={containerRef} className="image-frame">
      <img
        ref={imgRef}
        className="image-frame__img"
        src={media.mediaUrl}
        alt={media.title || ''}
        onLoad={handleLoad}
        onError={handleError}
        draggable={false}
      />
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
};
