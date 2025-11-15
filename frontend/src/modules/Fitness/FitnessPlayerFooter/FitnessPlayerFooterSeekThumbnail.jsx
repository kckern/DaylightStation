import PropTypes from 'prop-types';
import SingleThumbnailButton from '../SingleThumbnailButton.jsx';
import ProgressFrame from './ProgressFrame.jsx';
import './FitnessPlayerFooterSeekThumbnail.scss';

const clampRatio = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

const FitnessPlayerFooterSeekThumbnail = ({
  className,
  state,
  isOrigin = false,
  disabled = false,
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
  progressRatio = 0,
  showSpark,
  onSeek,
  onZoom,
  enableZoom,
  visibleRatio = 1
}) => {
  const containerClass = `${className}${disabled ? ' disabled' : ''}`;
  const perc = clampRatio(progressRatio);
  const sparkRatio = clampRatio(visibleRatio);

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
            <ProgressFrame
              className="progress-border-overlay"
              perc={perc}
              visibleRatio={sparkRatio}
              showSpark={showSpark}
            />
          )}
          <span className="thumbnail-time">{label}</span>
        </div>
      </div>
    </SingleThumbnailButton>
  );
};

FitnessPlayerFooterSeekThumbnail.propTypes = {
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
  enableZoom: PropTypes.bool,
  visibleRatio: PropTypes.number
};

export default FitnessPlayerFooterSeekThumbnail;
