/**
 * ProgressFrame v2 - Fresh Implementation
 * 
 * Displays a rounded rectangle progress indicator around thumbnails.
 * Uses dynamic viewBox that matches container dimensions to avoid
 * coordinate system mismatches.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import './ProgressFrame.scss';

// Constants
const STROKE_WIDTH = 3;
const CORNER_RADIUS = 4;
const SPARK_RADIUS = 4;

/**
 * Build path segments for a rounded rectangle
 * Path goes clockwise starting from top-left corner (after the arc)
 */
function buildPathData(width, height, stroke, radius) {
  const inset = stroke / 2;
  const r = Math.min(radius, (width - stroke) / 2, (height - stroke) / 2);
  
  // Corner positions (inner edge of stroke)
  const left = inset;
  const right = width - inset;
  const top = inset;
  const bottom = height - inset;
  
  // Path starts at top-left, goes clockwise
  // Start point: just after top-left arc, on the top edge
  const startX = left + r;
  const startY = top;
  
  // Build SVG path
  const d = [
    `M ${startX} ${startY}`,           // Start at top edge after TL corner
    `L ${right - r} ${top}`,           // Top edge →
    `A ${r} ${r} 0 0 1 ${right} ${top + r}`,  // TR arc ↘
    `L ${right} ${bottom - r}`,        // Right edge ↓
    `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`, // BR arc ↙
    `L ${left + r} ${bottom}`,         // Bottom edge ←
    `A ${r} ${r} 0 0 1 ${left} ${bottom - r}`,  // BL arc ↖
    `L ${left} ${top + r}`,            // Left edge ↑
    `A ${r} ${r} 0 0 1 ${startX} ${startY}`,    // TL arc → back to start
    'Z'
  ].join(' ');
  
  // Build segments array for endpoint calculation
  const arcLength = (Math.PI / 2) * r;
  const topEdge = right - r - (left + r);
  const rightEdge = bottom - r - (top + r);
  const bottomEdge = right - r - (left + r);
  const leftEdge = bottom - r - (top + r);
  
  const segments = [
    { type: 'line', length: topEdge, from: [left + r, top], to: [right - r, top] },
    { type: 'arc', length: arcLength, center: [right - r, top + r], startAngle: -Math.PI/2, endAngle: 0 },
    { type: 'line', length: rightEdge, from: [right, top + r], to: [right, bottom - r] },
    { type: 'arc', length: arcLength, center: [right - r, bottom - r], startAngle: 0, endAngle: Math.PI/2 },
    { type: 'line', length: bottomEdge, from: [right - r, bottom], to: [left + r, bottom] },
    { type: 'arc', length: arcLength, center: [left + r, bottom - r], startAngle: Math.PI/2, endAngle: Math.PI },
    { type: 'line', length: leftEdge, from: [left, bottom - r], to: [left, top + r] },
    { type: 'arc', length: arcLength, center: [left + r, top + r], startAngle: Math.PI, endAngle: Math.PI * 1.5 },
  ];
  
  const perimeter = segments.reduce((sum, s) => sum + s.length, 0);
  
  return { d, segments, perimeter, r };
}

/**
 * Calculate the (x, y) position along the path at a given distance
 */
function getPointAtLength(segments, targetLength, radius) {
  if (targetLength <= 0) {
    // Return start point (top edge, just after TL arc)
    return segments[0].from;
  }
  
  let accumulated = 0;
  
  for (const seg of segments) {
    if (accumulated + seg.length >= targetLength) {
      const remaining = targetLength - accumulated;
      const ratio = remaining / seg.length;
      
      if (seg.type === 'line') {
        return [
          seg.from[0] + (seg.to[0] - seg.from[0]) * ratio,
          seg.from[1] + (seg.to[1] - seg.from[1]) * ratio
        ];
      } else {
        // Arc segment
        const angle = seg.startAngle + (seg.endAngle - seg.startAngle) * ratio;
        return [
          seg.center[0] + radius * Math.cos(angle),
          seg.center[1] + radius * Math.sin(angle)
        ];
      }
    }
    accumulated += seg.length;
  }
  
  // Full loop - return start point
  return segments[0].from;
}

const ProgressFrame = ({
  perc = 0,
  visibleRatio = 1,
  showSpark = false,
  className = '',
  // Zoom overlay mode props (for progress bar zoom indicator)
  leftPct = null,
  widthPct = null
}) => {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 100, h: 100 });
  
  // Determine if this is zoom overlay mode (yellow rectangle on progress bar)
  const isZoomOverlayMode = leftPct != null && widthPct != null;
  
  // Track container size with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ w: width, h: height });
      }
    });
    
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  
  // ZOOM OVERLAY MODE: Render a positioned rectangle showing zoom range
  if (isZoomOverlayMode) {
    return (
      <div
        className={`progress-frame-zoom-overlay${className ? ` ${className}` : ''}`}
        style={{
          position: 'absolute',
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          top: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 200, 0, 0.5)',
          border: '1px solid rgba(255, 200, 0, 0.8)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 2
        }}
        aria-hidden="true"
      />
    );
  }
  
  // THUMBNAIL PROGRESS MODE: Render SVG border progress
  // Generate path data based on current dimensions
  const pathData = useMemo(() => 
    buildPathData(dimensions.w, dimensions.h, STROKE_WIDTH, CORNER_RADIUS),
    [dimensions.w, dimensions.h]
  );
  
  // Calculate progress values
  const safePerc = Math.max(0, Math.min(1, perc || 0));
  const safeRatio = Math.max(0, Math.min(1, visibleRatio || 1));
  const cappedPerc = Math.min(safePerc, safeRatio);
  
  const visibleLength = cappedPerc * pathData.perimeter;
  const dashArray = `${visibleLength} ${pathData.perimeter}`;
  
  // Calculate spark position
  const sparkPoint = useMemo(() => 
    getPointAtLength(pathData.segments, visibleLength, pathData.r),
    [pathData.segments, pathData.r, visibleLength]
  );
  
  const hasThumbnailOverlay = typeof perc === 'number' && !Number.isNaN(perc);
  
  if (!hasThumbnailOverlay) {
    return null;
  }
  
  return (
    <div
      ref={containerRef}
      className={`progress-frame-overlay${className ? ` ${className}` : ''}`}
    >
      <svg
        className="progress-frame-overlay__svg"
        viewBox={`0 0 ${dimensions.w} ${dimensions.h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Track (full border, dimmed) */}
        <path
          className="progress-frame-overlay__track"
          d={pathData.d}
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        
        {/* Progress fill */}
        <path
          className="progress-frame-overlay__fill"
          d={pathData.d}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeDasharray={dashArray}
          strokeDashoffset={0}
        />
        
        {/* Spark dot */}
        {showSpark && (
          <circle
            className="progress-frame-overlay__spark"
            cx={sparkPoint[0]}
            cy={sparkPoint[1]}
            r={SPARK_RADIUS}
          />
        )}
      </svg>
    </div>
  );
};

ProgressFrame.propTypes = {
  perc: PropTypes.number,
  visibleRatio: PropTypes.number,
  showSpark: PropTypes.bool,
  className: PropTypes.string,
  // Zoom overlay mode
  leftPct: PropTypes.number,
  widthPct: PropTypes.number
};

export default ProgressFrame;
