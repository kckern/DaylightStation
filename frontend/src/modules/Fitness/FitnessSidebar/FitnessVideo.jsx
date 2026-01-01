import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { Webcam as FitnessWebcam } from '../components/FitnessWebcam.jsx';
import { getDaylightLogger } from '../../../lib/logging/singleton.js';
import '../FitnessSidebar.scss';

const FitnessVideo = ({ minimal = false }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const webcamRef = useRef(null);
  const { toggleSidebarSizeMode } = useFitnessContext() || {};

  useEffect(() => {
    getDaylightLogger().info('fitness-video-mounted', { minimal });
  }, [minimal]);

  const videoConstraints = useMemo(() => ({ width: { ideal: 1280 }, height: { ideal: 720 } }), []);

  const handleStreamReady = useCallback(() => {
    setLoading(false);
    setError(null);
  }, []);

  const handleError = useCallback((err) => {
    setError(err?.message || 'Failed to access webcam');
    setLoading(false);
  }, []);

  return (
    <div 
      className="fitness-video-container" 
      style={minimal ? { 
        width: '100%',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        flexShrink: 0,
        aspectRatio: '16 / 9'
      } : {}}
    >
      {!minimal && (
        <div className="fitness-video-header">
          <h4>📹 Share Video</h4>
        </div>
      )}
      
      <div 
        className="fitness-video-wrapper" 
        style={minimal ? { 
          position: 'relative',
          width: '100%',
          height: '100%',
          margin: 0,
          padding: 0
        } : {}}
        onClick={() => { if (toggleSidebarSizeMode) toggleSidebarSizeMode(); }}
      >
        {loading && (
          <div className="video-status">
            <div className="status-icon">⏳</div>
            <div className="status-text">Requesting camera access...</div>
          </div>
        )}
        
        {error && (
          <div className="video-status error">
            <div className="status-icon">⚠️</div>
            <div className="status-text">{error}</div>
          </div>
        )}
        
        <FitnessWebcam
          ref={webcamRef}
          enabled
          audioConstraints={false}
          filterId="mirrorAdaptive"
          videoConstraints={videoConstraints}
          onStreamReady={handleStreamReady}
          onError={handleError}
          videoClassName="fitness-video-feed"
          videoStyle={{
            display: loading || error ? 'none' : 'block',
            ...(minimal ? {
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              margin: 0,
              padding: 0
            } : {})
          }}
          style={minimal ? { width: '100%', height: '100%' } : undefined}
          renderOverlay={({ status, error: overlayError, permissionError }) => (
            <>
              {(status === 'starting' || status === 'reconnecting') && (
                <div className="video-status">
                  <div className="status-icon">⏳</div>
                  <div className="status-text">Requesting camera access...</div>
                </div>
              )}
              {(overlayError || permissionError) && (
                <div className="video-status error">
                  <div className="status-icon">⚠️</div>
                  <div className="status-text">{overlayError?.message || permissionError?.message || 'Failed to access webcam'}</div>
                </div>
              )}
            </>
          )}
        />
      </div>
    </div>
  );
};

export default FitnessVideo;
