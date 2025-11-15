import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './ProgressFrame.scss';

const BORDER_VIEWBOX = 100;
const BORDER_STROKE = 3;
const BORDER_CORNER_RADIUS = 4;
const BORDER_MARGIN = BORDER_STROKE / 2;
const BORDER_RECT_SIZE = BORDER_VIEWBOX - BORDER_STROKE;
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const LOG_INTERVAL_MS = 3000;

const rectToObject = (rect) => (
  rect
    ? {
        x: rect.x,
        y: rect.y,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    : null
);

const buildPathDefinition = () => {
  const inset = BORDER_MARGIN;
  const width = BORDER_RECT_SIZE;
  const height = BORDER_RECT_SIZE;
  const r = BORDER_CORNER_RADIUS;
  const right = inset + width;
  const bottom = inset + height;
  return [
    `M ${inset} ${inset}`,
    `L ${right - r} ${inset}`,
    `A ${r} ${r} 0 0 1 ${right} ${inset + r}`,
    `L ${right} ${bottom - r}`,
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `L ${inset + r} ${bottom}`,
    `A ${r} ${r} 0 0 1 ${inset} ${bottom - r}`,
    `L ${inset} ${inset}`
  ].join(' ');
};

const BORDER_PATH_D = buildPathDefinition();

const SEGMENTS = (() => {
  const inset = BORDER_MARGIN;
  const width = BORDER_RECT_SIZE;
  const height = BORDER_RECT_SIZE;
  const r = BORDER_CORNER_RADIUS;
  const right = inset + width;
  const bottom = inset + height;
  const topLine = width - r;
  const rightSideLine = height - (2 * r);
  const bottomLine = width - (2 * r);
  const leftSideLine = height - r;
  const arcLength = (Math.PI / 2) * r;

  const list = [];
  list.push({ type: 'line', length: topLine, from: { x: inset, y: inset }, to: { x: right - r, y: inset } });
  list.push({ type: 'arc', length: arcLength, center: { x: right - r, y: inset + r }, radius: r, startAngle: -Math.PI / 2, endAngle: 0 });
  list.push({ type: 'line', length: rightSideLine, from: { x: right, y: inset + r }, to: { x: right, y: bottom - r } });
  list.push({ type: 'arc', length: arcLength, center: { x: right - r, y: bottom - r }, radius: r, startAngle: 0, endAngle: Math.PI / 2 });
  list.push({ type: 'line', length: bottomLine, from: { x: right - r, y: bottom }, to: { x: inset + r, y: bottom } });
  list.push({ type: 'arc', length: arcLength, center: { x: inset + r, y: bottom - r }, radius: r, startAngle: Math.PI / 2, endAngle: Math.PI });
  list.push({ type: 'line', length: leftSideLine, from: { x: inset, y: bottom - r }, to: { x: inset, y: inset } });
  return list;
})();

const PATH_PERIMETER = SEGMENTS.reduce((sum, seg) => sum + seg.length, 0);
const TOP_EDGE_RATIO = SEGMENTS.length ? SEGMENTS[0].length / PATH_PERIMETER : 0;
const SPARK_ANCHOR_RATIO = Math.min(0.01, TOP_EDGE_RATIO * 0.25);
const ORIGIN_POINT = {
  x: (BORDER_MARGIN / BORDER_VIEWBOX) * 100,
  y: (BORDER_MARGIN / BORDER_VIEWBOX) * 100
};
const getPointAt = (ratioInput) => {
  const target = clamp01(ratioInput);
  const distance = target * PATH_PERIMETER;
  let traversed = 0;
  for (const seg of SEGMENTS) {
    if (traversed + seg.length >= distance) {
      const segProgress = (distance - traversed) / seg.length;
      if (seg.type === 'line') {
        const x = seg.from.x + (seg.to.x - seg.from.x) * segProgress;
        const y = seg.from.y + (seg.to.y - seg.from.y) * segProgress;
        return { x: (x / BORDER_VIEWBOX) * 100, y: (y / BORDER_VIEWBOX) * 100 };
      }
      const angle = seg.startAngle + (seg.endAngle - seg.startAngle) * segProgress;
      const px = seg.center.x + seg.radius * Math.cos(angle);
      const py = seg.center.y + seg.radius * Math.sin(angle);
      return { x: (px / BORDER_VIEWBOX) * 100, y: (py / BORDER_VIEWBOX) * 100 };
    }
    traversed += seg.length;
  }
  const fallback = SEGMENTS[0].from;
  return { x: (fallback.x / BORDER_VIEWBOX) * 100, y: (fallback.y / BORDER_VIEWBOX) * 100 };
};

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
  const trackPathRef = useRef(null);
  const fillPathRef = useRef(null);
  const hasThumbnailOverlay = typeof perc === 'number' && !Number.isNaN(perc);
  const safePerc = clamp01(hasThumbnailOverlay ? perc : 0);
  const safeVisibleRatio = clamp01(visibleRatio);
  const cappedPerc = hasThumbnailOverlay ? Math.min(safePerc, safeVisibleRatio || 0) : 0;
  const hasProgress = cappedPerc > 0;
  const sparkRatio = showSpark ? Math.min(cappedPerc, 0.999) : null;
  const sparkPoint = showSpark && sparkRatio != null
    ? (sparkRatio <= SPARK_ANCHOR_RATIO ? ORIGIN_POINT : getPointAt(sparkRatio))
    : null;

  useEffect(() => {
    if (!hasThumbnailOverlay || typeof window === 'undefined') {
      return undefined;
    }

    const logMetrics = () => {
      const overlayEl = overlayRef.current;
      if (!overlayEl) {
        return;
      }

    };

    logMetrics();
    const intervalId = window.setInterval(logMetrics, LOG_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [hasThumbnailOverlay, perc, safePerc, safeVisibleRatio, cappedPerc, showSpark, sparkPoint]);

  if (hasThumbnailOverlay) {
    const dashLength = cappedPerc * PATH_PERIMETER;
    const dashArray = cappedPerc >= 1
      ? `${PATH_PERIMETER} ${PATH_PERIMETER}`
      : `${dashLength} ${PATH_PERIMETER}`;

    return (
      <div
        ref={overlayRef}
        className={`progress-frame-overlay${className ? ` ${className}` : ''}`}
      >
        <svg
          className="progress-frame-overlay__svg"
          viewBox={`0 0 ${BORDER_VIEWBOX} ${BORDER_VIEWBOX}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            ref={trackPathRef}
            className="progress-frame-overlay__track"
            d={BORDER_PATH_D}
            strokeWidth={BORDER_STROKE}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {hasProgress && (
            <path
              ref={fillPathRef}
              className="progress-frame-overlay__fill"
              d={BORDER_PATH_D}
              strokeWidth={BORDER_STROKE}
              strokeDasharray={dashArray}
              strokeDashoffset={0}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          )}
        </svg>
        {showSpark && sparkPoint && (
          <div
            className="progress-frame-overlay__spark"
            ref={sparkRef}
            style={{ left: `${sparkPoint.x}%`, top: `${sparkPoint.y}%` }}
          >
            <div className="spark-core" />
          </div>
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
