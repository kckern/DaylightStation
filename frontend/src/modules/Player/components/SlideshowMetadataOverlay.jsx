import React, { useRef, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';
import './SlideshowMetadataOverlay.scss';

const logger = getLogger().child({ component: 'SlideshowMetadataOverlay' });

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
    const yearDiff = now.getFullYear() - d.getFullYear();
    const monthDiff = yearDiff * 12 + (now.getMonth() - d.getMonth());
    // Same calendar day but timestamp hasn't crossed → use calendar year diff
    // (e.g. March 4 2025 17:57 viewed on March 4 2026 12:00 = "1 year ago")
    const sameDay = now.getMonth() === d.getMonth() && now.getDate() === d.getDate();
    if (sameDay && yearDiff >= 1) {
      return yearDiff === 1 ? '1 year ago' : `${yearDiff} years ago`;
    }
    if (monthDiff < 12) return monthDiff === 1 ? '1 month ago' : `${monthDiff} months ago`;
    const years = Math.round(days / 365.25);
    return years === 1 ? '1 year ago' : `${years} years ago`;
  } catch {
    return null;
  }
}

/**
 * SlideshowMetadataOverlay — shared metadata overlay for images and videos.
 *
 * JIT-fetches metadata from /api/v1/info/{id} and renders a Getty-style
 * date/people/location bar. Uses Web Animations API for fade (TVApp kills CSS
 * transitions).
 *
 * @prop {string}  mediaId    — Content ID to fetch metadata for
 * @prop {boolean} visible    — When true, fade in; when false, fade out
 * @prop {number}  fadeInMs   — Fade-in duration (default 600)
 * @prop {number}  fadeOutMs  — Fade-out duration (default 800)
 * @prop {object}  preloaded  — Optional pre-fetched { capturedAt, people, location }
 */
export function SlideshowMetadataOverlay({
  mediaId,
  visible,
  fadeInMs = 600,
  fadeOutMs = 800,
  preloaded,
  variant,
}) {
  const elRef = useRef(null);
  const animRef = useRef(null);
  const prevVisibleRef = useRef(false);
  const [fetched, setFetched] = useState({ forId: null, capturedAt: null, people: null, location: null });

  // JIT fetch metadata (skip if preloaded is provided for this ID)
  useEffect(() => {
    if (!mediaId) return;
    if (preloaded) return; // parent already provided metadata

    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const res = await fetch(`/api/v1/info/${encodeURIComponent(mediaId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const meta = data.metadata || {};
        setFetched({
          forId: mediaId,
          capturedAt: meta.capturedAt || null,
          people: meta.people?.length > 0 ? meta.people : null,
          location: meta.location || null,
        });
        logger.debug('metadata-overlay-fetched', {
          mediaId,
          hasCapturedAt: !!meta.capturedAt,
          peopleCount: meta.people?.length || 0,
          hasLocation: !!meta.location,
        });
      } catch (err) {
        logger.warn('metadata-overlay-fetch-error', { mediaId, error: err.message });
      }
    };
    fetchMeta();
    return () => { cancelled = true; };
  }, [mediaId, preloaded]);

  // Reset fetched state when mediaId changes
  useEffect(() => {
    setFetched(prev => (prev.forId === mediaId ? prev : { forId: null, capturedAt: null, people: null, location: null }));
  }, [mediaId]);

  // Resolve effective metadata: preloaded > fetched
  const source = preloaded || (fetched.forId === mediaId ? fetched : null);
  const overlay = useMemo(() => {
    if (!source) return null;
    const names = (source.people || []).map(p => p.name).filter(Boolean);
    const date = formatPhotoDate(source.capturedAt);
    const timeAgo = formatTimeAgo(source.capturedAt);
    const location = source.location || null;
    if (!names.length && !date && !location) return null;
    return { names, date, timeAgo, location };
  }, [source]);

  // Fade in/out via Web Animations API
  useEffect(() => {
    const el = elRef.current;
    if (!el || !overlay) return;

    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (visible && !wasVisible) {
      if (animRef.current) animRef.current.cancel();
      animRef.current = el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: fadeInMs, fill: 'forwards', easing: 'ease-in' }
      );
    } else if (!visible && wasVisible) {
      if (animRef.current) animRef.current.cancel();
      animRef.current = el.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: fadeOutMs, fill: 'forwards', easing: 'ease-out' }
      );
    }
  }, [visible, overlay, fadeInMs, fadeOutMs]);

  if (!overlay) return null;

  return (
    <div ref={elRef} className={`slideshow-metadata${variant ? ` slideshow-metadata--${variant}` : ''}`} style={{ opacity: 0 }}>
      <div className="slideshow-metadata__backdrop" />
      <div className="slideshow-metadata__content">
        {overlay.date && (
          <span className="slideshow-metadata__date">
            {overlay.date}
            {overlay.timeAgo && (
              <span className="slideshow-metadata__ago">{overlay.timeAgo}</span>
            )}
          </span>
        )}
        {overlay.names.length > 0 && (
          <span className="slideshow-metadata__people">{overlay.names.join(' \u00b7 ')}</span>
        )}
        {overlay.location && (
          <span className="slideshow-metadata__location">{overlay.location}</span>
        )}
      </div>
    </div>
  );
}

SlideshowMetadataOverlay.propTypes = {
  mediaId: PropTypes.string,
  visible: PropTypes.bool,
  fadeInMs: PropTypes.number,
  fadeOutMs: PropTypes.number,
  preloaded: PropTypes.shape({
    capturedAt: PropTypes.string,
    people: PropTypes.array,
    location: PropTypes.string,
  }),
  variant: PropTypes.string,
};
