import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import SingleThumbnailButton from '../SingleThumbnailButton.jsx';
import ProgressFrame from './ProgressFrame.jsx';
import './FitnessPlayerFooterSeekThumbnail.scss';

const clampRatio = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const REFRESH_INTERVAL_MS = 8000;
const THUMBNAIL_TIME_OFFSET_MS = 10000;
const TIMESTAMP_PATTERNS = [
  /(\/indexes\/(?:sd|ld)\/)(\d+)/i,
  /(\/thumb\/)(\d+)/i,
  /(indexes%2F(?:sd|ld)%2F)(\d+)/i,
  /(thumb%2F)(\d+)/i
];

const updateThumbnailTimestamp = (src, seconds) => {
  if (!src || !Number.isFinite(seconds)) return null;
  const timestamp = Math.max(0, Math.floor(seconds * 1000));
  for (const pattern of TIMESTAMP_PATTERNS) {
    if (pattern.test(src)) {
      return src.replace(pattern, (match, prefix) => `${prefix}${timestamp}`);
    }
  }
  return null;
};

const supportsLivePreview = (src) => {
  if (!src || typeof src !== 'string') return false;
  return TIMESTAMP_PATTERNS.some((pattern) => pattern.test(src));
};

const FitnessPlayerFooterSeekThumbnail = ({
  className,
  state,
  index = 0,
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
  visibleRatio = 1,
  telemetryMeta = null,
  onTelemetry
}) => {
  const containerClass = `${className}${disabled ? ' disabled' : ''}`;
  const perc = clampRatio(progressRatio);
  const sparkRatio = clampRatio(visibleRatio);
  
  const [panToggle, setPanToggle] = useState(false);
  const [posterFallbackActive, setPosterFallbackActive] = useState(false);
  const [imageUnavailable, setImageUnavailable] = useState(!imgSrc);
  const [liveFrameSrc, setLiveFrameSrc] = useState(imgSrc || null);
  const progressRatioRef = useRef(clampRatio(progressRatio));
  const [frameState, setFrameState] = useState(() => ({
    activeIndex: 0,
    pendingIndex: null,
    layers: [
      { id: 0, src: imgSrc || null, loaded: !!imgSrc, direction: 'normal' },
      { id: 1, src: null, loaded: false, direction: 'reverse' }
    ]
  }));

  useEffect(() => {
    progressRatioRef.current = clampRatio(progressRatio);
  }, [progressRatio]);

  useEffect(() => {
    setPosterFallbackActive(false);
    setImageUnavailable(!imgSrc);
    setLiveFrameSrc(imgSrc || null);
    setFrameState((prev) => ({
      activeIndex: 0,
      pendingIndex: null,
      layers: [
        { ...prev.layers[0], id: 0, src: imgSrc || null, loaded: !!imgSrc, direction: 'normal' },
        { ...prev.layers[1], id: 1, src: null, loaded: false, direction: 'reverse' }
      ]
    }));
  }, [imgSrc, posterSrc]);

  useEffect(() => {
    if (!isActive) {
      setLiveFrameSrc(imgSrc || null);
    }
  }, [isActive, imgSrc]);

  const canAnimateThumbnail = useMemo(() => supportsLivePreview(imgSrc), [imgSrc]);

  useEffect(() => {
    if (!isActive || !canAnimateThumbnail || posterFallbackActive || imageUnavailable) return undefined;

    const updateFrame = () => {
      const safeStart = Number.isFinite(segmentStart) ? segmentStart : 0;
      const safeEnd = Number.isFinite(segmentEnd) ? segmentEnd : safeStart;
      const span = Math.max(safeEnd - safeStart, 0);
      const ratio = span > 0 ? progressRatioRef.current : 0;
      const liveTime = safeStart + span * ratio + (THUMBNAIL_TIME_OFFSET_MS / 1000);
      const nextSrc = updateThumbnailTimestamp(imgSrc, liveTime);
      if (nextSrc) {
        setLiveFrameSrc((prev) => (prev === nextSrc ? prev : nextSrc));
      }
    };

    updateFrame();
    const intervalId = setInterval(updateFrame, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isActive, canAnimateThumbnail, posterFallbackActive, imageUnavailable, imgSrc, segmentStart, segmentEnd]);

  const resolvedSrc = useMemo(() => {
    if (imageUnavailable) return null;
    if (posterFallbackActive) return posterSrc || null;
    if (isActive && canAnimateThumbnail) return liveFrameSrc || imgSrc || null;
    return imgSrc || null;
  }, [imageUnavailable, posterFallbackActive, posterSrc, isActive, canAnimateThumbnail, liveFrameSrc, imgSrc]);

  useEffect(() => {
    if (resolvedSrc) {
      setPanToggle((prev) => !prev);
    }
  }, [resolvedSrc]);

  useEffect(() => {
    setFrameState((prev) => {
      if (!resolvedSrc) {
        if (!prev.layers.some((layer) => layer.src)) return prev;
        return {
          activeIndex: 0,
          pendingIndex: null,
          layers: prev.layers.map((layer) => ({ ...layer, src: null, loaded: false }))
        };
      }

      const activeLayer = prev.layers[prev.activeIndex];
      if (activeLayer?.src === resolvedSrc) {
        return prev;
      }

      const inactiveIndex = prev.activeIndex === 0 ? 1 : 0;
      const inactiveLayer = prev.layers[inactiveIndex];
      if (inactiveLayer?.src === resolvedSrc && prev.pendingIndex === inactiveIndex) {
        return prev;
      }

      const nextDirection = activeLayer.direction === 'normal' ? 'reverse' : 'normal';

      const layers = prev.layers.map((layer, idx) => (
        idx === inactiveIndex
          ? { ...layer, src: resolvedSrc, loaded: false, direction: nextDirection }
          : layer
      ));

      return {
        ...prev,
        layers,
        pendingIndex: inactiveIndex
      };
    });
  }, [resolvedSrc]);

  const handleLayerLoad = (layerIndex) => {
    setFrameState((prev) => {
      const layers = prev.layers.map((layer, idx) => (
        idx === layerIndex ? { ...layer, loaded: true } : layer
      ));

      if (prev.pendingIndex === layerIndex) {
        return {
          layers,
          activeIndex: layerIndex,
          pendingIndex: null
        };
      }

      return { ...prev, layers };
    });
  };

  const handleLayerError = (failedSrc) => {
    if (!posterFallbackActive && posterSrc && failedSrc !== posterSrc) {
      setPosterFallbackActive(true);
      setImageUnavailable(false);
      setLiveFrameSrc(posterSrc);
      return;
    }
    setImageUnavailable(true);
    setLiveFrameSrc(null);
  };

  const hasVisibleImage = useMemo(() => (
    frameState.layers.some((layer, idx) => layer.src && idx === frameState.activeIndex && layer.loaded)
  ), [frameState]);

  const showFallback = !resolvedSrc || !hasVisibleImage || imageUnavailable;

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
      telemetryMeta={telemetryMeta}
      onTelemetry={onTelemetry}
    >
      <div
        className={containerClass}
        data-pos={segmentStart}
        data-sample-time={sampleTime}
        data-label-time={labelTime}
        data-origin={isOrigin ? '1' : '0'}
        style={{
          '--pan-duration': `${REFRESH_INTERVAL_MS / 1000}s`,
          '--pan-direction': panToggle ? 'normal' : 'reverse'
        }}
      >
        <div className="thumbnail-wrapper">
          <div className="seek-thumbnail-stack">
            {frameState.layers.map((layer, idx) => (
              layer.src ? (
                <img
                  key={`${layer.id}-${layer.src}`}
                  src={layer.src}
                  alt=""
                  loading="lazy"
                  className="seek-thumbnail-layer"
                  data-visible={idx === frameState.activeIndex && layer.loaded ? 'true' : 'false'}
                  data-layer={idx}
                  style={{ '--layer-pan-direction': layer.direction || 'normal' }}
                  onLoad={() => handleLayerLoad(idx)}
                  onError={(e) => handleLayerError(e.currentTarget?.src)}
                />
              ) : null
            ))}
          </div>
          <div
            className="thumbnail-fallback"
            style={{
              backgroundColor: greyBg,
              display: showFallback ? 'block' : 'none'
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
  index: PropTypes.number,
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
  visibleRatio: PropTypes.number,
  telemetryMeta: PropTypes.object,
  onTelemetry: PropTypes.func
};

export default FitnessPlayerFooterSeekThumbnail;
