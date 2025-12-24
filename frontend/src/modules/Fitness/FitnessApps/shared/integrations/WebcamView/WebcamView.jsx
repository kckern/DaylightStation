import React from 'react';
import PropTypes from 'prop-types';
import { Webcam as FitnessWebcam } from '../../../../components/FitnessWebcam.jsx';
import './WebcamView.scss';

const WebcamView = ({
  enabled = true,
  mirror = true,
  aspectRatio = '4:3',
  showControls = false,
  captureInterval,
  onCapture,
  overlay,
  filter,
  className,
  ...props
}) => {
  const [width, height] = aspectRatio.split(':').map(Number);
  const ratio = (height / width) * 100;

  return (
    <div 
      className={`webcam-view ${mirror ? 'webcam-view--mirror' : ''} ${className || ''}`}
      style={{ paddingBottom: `${ratio}%` }}
    >
      <div className="webcam-view__content">
        <FitnessWebcam
          enabled={enabled}
          showControls={showControls}
          captureIntervalMs={captureInterval}
          onSnapshot={onCapture}
          filterId={filter}
          className="webcam-view__camera"
          {...props}
        />
        {overlay && (
          <div className="webcam-view__overlay">
            {overlay}
          </div>
        )}
      </div>
    </div>
  );
};

WebcamView.propTypes = {
  enabled: PropTypes.bool,
  mirror: PropTypes.bool,
  aspectRatio: PropTypes.string,
  showControls: PropTypes.bool,
  captureInterval: PropTypes.number,
  onCapture: PropTypes.func,
  overlay: PropTypes.node,
  filter: PropTypes.string,
  className: PropTypes.string
};

export default WebcamView;
