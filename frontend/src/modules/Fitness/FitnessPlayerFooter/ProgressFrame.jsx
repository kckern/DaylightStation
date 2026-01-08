import { useEffect, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import { getDaylightLogger } from '../../../lib/logging/singleton.js';
import './ProgressFrame.scss';

const logger = getDaylightLogger({ context: { component: 'ProgressFrame' } });

// Constants
const VIEWBOX = 100;
const STROKE = 3;
const RADIUS = 4;
const INSET = STROKE / 2;
const SIZE = VIEWBOX - STROKE;
const RIGHT = INSET + SIZE;
const BOTTOM = INSET + SIZE;

const DEBUG_SPARK = false;
const LOG_INTERVAL_MS = 500;

// Segment definitions (clockwise from top-left)
const SEGMENTS = [
  { type: 'line', from: [INSET, INSET], to: [RIGHT - RADIUS, INSET], length: SIZE - RADIUS },
  { type: 'arc', center: [RIGHT - RADIUS, INSET + RADIUS], startAngle: -Math.PI / 2, endAngle: 0, length: (Math.PI / 2) * RADIUS },
  { type: 'line', from: [RIGHT, INSET + RADIUS], to: [RIGHT, BOTTOM - RADIUS], length: SIZE - 2 * RADIUS },
  { type: 'arc', center: [RIGHT - RADIUS, BOTTOM - RADIUS], startAngle: 0, endAngle: Math.PI / 2, length: (Math.PI / 2) * RADIUS },
  { type: 'line', from: [RIGHT - RADIUS, BOTTOM], to: [INSET + RADIUS, BOTTOM], length: SIZE - 2 * RADIUS },
  { type: 'arc', center: [INSET + RADIUS, BOTTOM - RADIUS], startAngle: Math.PI / 2, endAngle: Math.PI, length: (Math.PI / 2) * RADIUS },
  { type: 'line', from: [INSET, BOTTOM - RADIUS], to: [INSET, INSET + RADIUS], length: SIZE - 2 * RADIUS },
  { type: 'arc', center: [INSET + RADIUS, INSET + RADIUS], startAngle: Math.PI, endAngle: 3 * Math.PI / 2, length: (Math.PI / 2) * RADIUS }
];

const PERIMETER = SEGMENTS.reduce((sum, s) => sum + s.length, 0);

// Build the full track path (for the background)
const TRACK_PATH = (() => {
  const parts = [`M ${INSET} ${INSET}`];
  for (const seg of SEGMENTS) {
    if (seg.type === 'line') {
      parts.push(`L ${seg.to[0]} ${seg.to[1]}`);
    } else {
      const endX = seg.center[0] + RADIUS * Math.cos(seg.endAngle);
      const endY = seg.center[1] + RADIUS * Math.sin(seg.endAngle);
      parts.push(`A ${RADIUS} ${RADIUS} 0 0 1 ${endX} ${endY}`);
    }
  }
  return parts.join(' ');
})();

// Build a progress path that draws ONLY the visible portion (no dasharray needed)
const buildProgressPath = (progress) => {
  if (progress <= 0) return '';

  const targetLength = Math.min(progress, 1) * PERIMETER;
  let remaining = targetLength;
  const parts = [`M ${SEGMENTS[0].from[0]} ${SEGMENTS[0].from[1]}`];

  for (const seg of SEGMENTS) {
    if (remaining <= 0) break;

    if (seg.type === 'line') {
      if (remaining >= seg.length) {
        parts.push(`L ${seg.to[0]} ${seg.to[1]}`);
        remaining -= seg.length;
      } else {
        const ratio = remaining / seg.length;
        const endX = seg.from[0] + (seg.to[0] - seg.from[0]) * ratio;
        const endY = seg.from[1] + (seg.to[1] - seg.from[1]) * ratio;
        parts.push(`L ${endX} ${endY}`);
        remaining = 0;
      }
    } else {
      if (remaining >= seg.length) {
        const endX = seg.center[0] + RADIUS * Math.cos(seg.endAngle);
        const endY = seg.center[1] + RADIUS * Math.sin(seg.endAngle);
        parts.push(`A ${RADIUS} ${RADIUS} 0 0 1 ${endX} ${endY}`);
        remaining -= seg.length;
      } else {
        const ratio = remaining / seg.length;
        const endAngle = seg.startAngle + (seg.endAngle - seg.startAngle) * ratio;
        const endX = seg.center[0] + RADIUS * Math.cos(endAngle);
        const endY = seg.center[1] + RADIUS * Math.sin(endAngle);
        parts.push(`A ${RADIUS} ${RADIUS} 0 0 1 ${endX} ${endY}`);
        remaining = 0;
      }
    }
  }

  return parts.join(' ');
};

// Get the endpoint coordinates for the spark
const getEndpoint = (progress) => {
  if (progress <= 0) return { x: INSET, y: INSET };

  const targetLength = Math.min(progress, 1) * PERIMETER;
  let remaining = targetLength;

  for (const seg of SEGMENTS) {
    if (remaining <= seg.length) {
      const ratio = remaining / seg.length;
      if (seg.type === 'line') {
        return {
          x: seg.from[0] + (seg.to[0] - seg.from[0]) * ratio,
          y: seg.from[1] + (seg.to[1] - seg.from[1]) * ratio
        };
      } else {
        const angle = seg.startAngle + (seg.endAngle - seg.startAngle) * ratio;
        return {
          x: seg.center[0] + RADIUS * Math.cos(angle),
          y: seg.center[1] + RADIUS * Math.sin(angle)
        };
      }
    }
    remaining -= seg.length;
  }

  // Full loop - return start point
  return { x: INSET, y: INSET };
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const ProgressFrame = ({
  leftPct,
  widthPct,
  perc,
  visibleRatio = 1,
  showSpark = false,
  className = ''
}) => {
  const overlayRef = useRef(null);
  const sparkRef = useRef(null);

  const hasThumbnailOverlay = typeof perc === 'number' && !Number.isNaN(perc);
  const safePerc = clamp01(hasThumbnailOverlay ? perc : 0);
  const cappedPerc = hasThumbnailOverlay ? Math.min(safePerc, clamp01(visibleRatio) || 0) : 0;
  const hasProgress = cappedPerc > 0;
  // Always show spark at origin when active, even at 0% progress
  const showSparkAtOrigin = showSpark && hasThumbnailOverlay;

  // Build paths
  const progressPath = useMemo(() => buildProgressPath(cappedPerc), [cappedPerc]);
  const endpoint = useMemo(() => getEndpoint(cappedPerc), [cappedPerc]);

  // Convert endpoint to CSS percentages
  const sparkX = (endpoint.x / VIEWBOX) * 100;
  const sparkY = (endpoint.y / VIEWBOX) * 100;

  // Debug logging
  useEffect(() => {
    if (!DEBUG_SPARK || !hasThumbnailOverlay || typeof window === 'undefined') {
      return undefined;
    }

    const logMetrics = () => {
      const overlayEl = overlayRef.current;
      if (!overlayEl) return;

      const rect = overlayEl.getBoundingClientRect();
      logger.info('spark-position', {
        progress: `${(cappedPerc * 100).toFixed(1)}%`,
        container: { w: rect.width.toFixed(0), h: rect.height.toFixed(0) },
        endpoint: { x: endpoint.x.toFixed(2), y: endpoint.y.toFixed(2) },
        sparkPct: { x: sparkX.toFixed(2), y: sparkY.toFixed(2) }
      });
    };

    logMetrics();
    const intervalId = setInterval(logMetrics, LOG_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [hasThumbnailOverlay, cappedPerc, endpoint, sparkX, sparkY]);

  if (hasThumbnailOverlay) {
    return (
      <div
        ref={overlayRef}
        className={`progress-frame-overlay${className ? ` ${className}` : ''}`}
      >
        <svg
          className="progress-frame-overlay__svg"
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Track (full border, dimmed) */}
          <path
            className="progress-frame-overlay__track"
            d={TRACK_PATH}
            strokeWidth={STROKE}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {/* Progress (only the visible portion) */}
          {hasProgress && (
            <path
              className="progress-frame-overlay__fill"
              d={progressPath}
              strokeWidth={STROKE}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* Spark dot - show at origin even at 0% progress */}
        {showSparkAtOrigin && (
          <div
            ref={sparkRef}
            className="progress-frame-overlay__spark"
            style={{ left: `${sparkX}%`, top: `${sparkY}%` }}
          />
        )}
      </div>
    );
  }

  if (typeof leftPct === 'number' && typeof widthPct === 'number') {
    return (
      <div
        className="progress-zoom-window"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
    );
  }

  return null;
};

ProgressFrame.propTypes = {
  leftPct: PropTypes.number,
  widthPct: PropTypes.number,
  perc: PropTypes.number,
  visibleRatio: PropTypes.number,
  showSpark: PropTypes.bool,
  className: PropTypes.string
};

export default ProgressFrame;
