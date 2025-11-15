import PropTypes from 'prop-types';
import SingleThumbnailButton from '../SingleThumbnailButton.jsx';
import './SeekThumbnail.scss';

const BORDER_VIEWBOX = 100;
const BORDER_STROKE = 3;
const BORDER_CORNER_RADIUS = 4;
const BORDER_OFFSET = BORDER_STROKE / 2;
const BORDER_MARGIN = BORDER_OFFSET;
const BORDER_RECT_SIZE = BORDER_VIEWBOX - BORDER_STROKE;
const BORDER_STRAIGHT_LENGTH = BORDER_RECT_SIZE - (BORDER_CORNER_RADIUS * 2);
const BORDER_CORNER_LENGTH = (Math.PI * BORDER_CORNER_RADIUS) / 2;
const BORDER_PERIMETER = (BORDER_STRAIGHT_LENGTH * 4) + (BORDER_CORNER_LENGTH * 4);

const BORDER_POINTS = Object.freeze({
  topY: BORDER_OFFSET,
  bottomY: BORDER_VIEWBOX - BORDER_OFFSET,
  leftX: BORDER_OFFSET,
  rightX: BORDER_VIEWBOX - BORDER_OFFSET,
  topStraightStartX: BORDER_OFFSET + BORDER_CORNER_RADIUS,
  topStraightEndX: BORDER_VIEWBOX - BORDER_OFFSET - BORDER_CORNER_RADIUS,
  sideStraightStartY: BORDER_OFFSET + BORDER_CORNER_RADIUS,
  sideStraightEndY: BORDER_VIEWBOX - BORDER_OFFSET - BORDER_CORNER_RADIUS
});

const BORDER_CENTERS = Object.freeze({
  topRight: {
    x: BORDER_POINTS.rightX - BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.topY + BORDER_CORNER_RADIUS
  },
  bottomRight: {
    x: BORDER_POINTS.rightX - BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.bottomY - BORDER_CORNER_RADIUS
  },
  bottomLeft: {
    x: BORDER_POINTS.leftX + BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.bottomY - BORDER_CORNER_RADIUS
  },
  topLeft: {
    x: BORDER_POINTS.leftX + BORDER_CORNER_RADIUS,
    y: BORDER_POINTS.topY + BORDER_CORNER_RADIUS
  }
});

const toPercent = (value) => (value / BORDER_VIEWBOX) * 100;
const clampRatio = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const getSparkPoint = (ratioInput) => {
  const ratio = clampRatio(ratioInput >= 1 ? 0.9999 : ratioInput);
  let remaining = ratio * BORDER_PERIMETER;

  const consume = (length) => {
    const amount = Math.min(length, remaining);
    remaining -= amount;
    return amount / length;
  };

  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = consume(BORDER_STRAIGHT_LENGTH);
    const x = BORDER_POINTS.topStraightStartX + (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(x), top: toPercent(BORDER_POINTS.topY) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  if (remaining <= BORDER_CORNER_LENGTH) {
    const t = remaining / BORDER_CORNER_LENGTH;
    const angle = (-Math.PI / 2) + (t * (Math.PI / 2));
    const x = BORDER_CENTERS.topRight.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
    const y = BORDER_CENTERS.topRight.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
    return { left: toPercent(x), top: toPercent(y) };
  }
  remaining -= BORDER_CORNER_LENGTH;

  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = remaining / BORDER_STRAIGHT_LENGTH;
    const y = BORDER_POINTS.sideStraightStartY + (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(BORDER_POINTS.rightX), top: toPercent(y) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  if (remaining <= BORDER_CORNER_LENGTH) {
    const t = remaining / BORDER_CORNER_LENGTH;
    const angle = (t * (Math.PI / 2));
    const x = BORDER_CENTERS.bottomRight.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
    const y = BORDER_CENTERS.bottomRight.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
    return { left: toPercent(x), top: toPercent(y) };
  }
  remaining -= BORDER_CORNER_LENGTH;

  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = remaining / BORDER_STRAIGHT_LENGTH;
    const x = BORDER_POINTS.topStraightEndX - (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(x), top: toPercent(BORDER_POINTS.bottomY) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  if (remaining <= BORDER_CORNER_LENGTH) {
    const t = remaining / BORDER_CORNER_LENGTH;
    const angle = (Math.PI / 2) + (t * (Math.PI / 2));
    const x = BORDER_CENTERS.bottomLeft.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
    const y = BORDER_CENTERS.bottomLeft.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
    return { left: toPercent(x), top: toPercent(y) };
  }
  remaining -= BORDER_CORNER_LENGTH;

  if (remaining <= BORDER_STRAIGHT_LENGTH) {
    const t = remaining / BORDER_STRAIGHT_LENGTH;
    const y = BORDER_POINTS.sideStraightEndY - (t * BORDER_STRAIGHT_LENGTH);
    return { left: toPercent(BORDER_POINTS.leftX), top: toPercent(y) };
  }
  remaining -= BORDER_STRAIGHT_LENGTH;

  const t = (remaining / BORDER_CORNER_LENGTH);
  const angle = Math.PI + (t * (Math.PI / 2));
  const x = BORDER_CENTERS.topLeft.x + (BORDER_CORNER_RADIUS * Math.cos(angle));
  const y = BORDER_CENTERS.topLeft.y + (BORDER_CORNER_RADIUS * Math.sin(angle));
  return { left: toPercent(x), top: toPercent(y) };
};

const SeekThumbnail = ({
  className,
  state,
  isOrigin,
  disabled,
  segmentStart,
  segmentEnd,
  globalRangeStart,
  globalRangeEnd,
  sampleTime,
  labelTime,
  seekTime,
  imgSrc,
  posterSrc,
  greyBg,
  label,
  isActive,
  progressRatio,
  showSpark,
  onSeek,
  onZoom,
  enableZoom
}) => {
  const containerClass = `${className}${disabled ? ' disabled' : ''}`;
  const strokeDashoffset = (1 - progressRatio) * BORDER_PERIMETER;
  const sparkPoint = showSpark ? getSparkPoint(progressRatio) : null;

  return (
    <SingleThumbnailButton
      pos={sampleTime}
      rangeStart={segmentStart}
      rangeEnd={segmentEnd}
      state={state}
      onSeek={onSeek}
      onZoom={onZoom}
      enableZoom={enableZoom}
      globalStart={globalRangeStart}
      globalEnd={globalRangeEnd}
      seekTime={seekTime}
      labelTime={labelTime}
    >
      <div
        className={containerClass}
        data-pos={segmentStart}
        data-sample-time={sampleTime}
        data-label-time={labelTime}
        data-origin={isOrigin ? '1' : '0'}
      >
        <div className="thumbnail-wrapper">
          {imgSrc ? (
            <img
              key={`${imgSrc}-${segmentStart}`}
              src={imgSrc}
              alt=""
              className="seek-thumbnail"
              loading="lazy"
              onLoad={(e) => {
                e.target.style.display = '';
              }}
              onError={(e) => {
                if (posterSrc && e.target.src !== posterSrc && !e.target.hasAttribute('data-poster-tried')) {
                  e.target.setAttribute('data-poster-tried', 'true');
                  e.target.src = posterSrc;
                } else {
                  e.target.style.display = 'none';
                }
              }}
            />
          ) : null}
          <div
            className="thumbnail-fallback"
            style={{
              backgroundColor: greyBg,
              display: imgSrc ? 'none' : 'block'
            }}
          />
          {isActive && (
            <div className="progress-border-overlay">
              <svg
                className="progress-border-overlay__svg"
                viewBox={`0 0 ${BORDER_VIEWBOX} ${BORDER_VIEWBOX}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect
                  className="progress-border-overlay__track"
                  x={BORDER_MARGIN}
                  y={BORDER_MARGIN}
                  width={BORDER_RECT_SIZE}
                  height={BORDER_RECT_SIZE}
                  rx={BORDER_CORNER_RADIUS}
                  ry={BORDER_CORNER_RADIUS}
                  strokeWidth={BORDER_STROKE}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  className="progress-border-overlay__fill"
                  x={BORDER_MARGIN}
                  y={BORDER_MARGIN}
                  width={BORDER_RECT_SIZE}
                  height={BORDER_RECT_SIZE}
                  rx={BORDER_CORNER_RADIUS}
                  ry={BORDER_CORNER_RADIUS}
                  strokeWidth={BORDER_STROKE}
                  strokeDasharray={BORDER_PERIMETER}
                  strokeDashoffset={strokeDashoffset}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                />
              </svg>
              {showSpark && sparkPoint && (
                <div className="progress-border-overlay__spark" style={sparkPoint}>
                  <div className="spark-core" />
                </div>
              )}
            </div>
          )}
          <span className="thumbnail-time">{label}</span>
        </div>
      </div>
    </SingleThumbnailButton>
  );
};

SeekThumbnail.propTypes = {
  className: PropTypes.string.isRequired,
  state: PropTypes.oneOf(['active', 'past', 'future']).isRequired,
  isOrigin: PropTypes.bool,
  disabled: PropTypes.bool,
  segmentStart: PropTypes.number,
  segmentEnd: PropTypes.number,
  globalRangeStart: PropTypes.number,
  globalRangeEnd: PropTypes.number,
  sampleTime: PropTypes.number,
  labelTime: PropTypes.number,
  seekTime: PropTypes.number,
  imgSrc: PropTypes.string,
  posterSrc: PropTypes.string,
  greyBg: PropTypes.string,
  label: PropTypes.string,
  isActive: PropTypes.bool,
  progressRatio: PropTypes.number,
  showSpark: PropTypes.bool,
  onSeek: PropTypes.func,
  onZoom: PropTypes.func,
  enableZoom: PropTypes.bool
};

export default SeekThumbnail;
