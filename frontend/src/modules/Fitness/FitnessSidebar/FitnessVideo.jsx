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
  
  // TELEMETRY: Track component lifecycle and resource usage
  const mountTimeRef = useRef(Date.now());
  const healthCheckIntervalRef = useRef(null);
  const streamStartTimeRef = useRef(null);
  const errorCountRef = useRef(0);
  const componentIdRef = useRef(`video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

  // TELEMETRY: Mount and lifecycle tracking
  useEffect(() => {
    const logger = getDaylightLogger();
    const componentId = componentIdRef.current;
    
    logger.info('fitness.video.mounted', { 
      minimal, 
      componentId,
      timestamp: Date.now()
    });
    
    // TELEMETRY: Periodic health check every 30 seconds
    healthCheckIntervalRef.current = setInterval(() => {
      const uptime = Date.now() - mountTimeRef.current;
      const streamUptime = streamStartTimeRef.current ? Date.now() - streamStartTimeRef.current : null;
      const hasStream = !!webcamRef.current?.stream;
      const streamActive = hasStream && webcamRef.current.stream.active;
      const trackCount = hasStream ? webcamRef.current.stream.getTracks?.().length : 0;
      
      // Memory snapshot if available
      let memoryInfo = null;
      if (performance.memory) {
        memoryInfo = {
          usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
          jsHeapSizeLimit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
      }
      
      logger.debug('fitness.video.health', {
        componentId,
        uptimeMs: uptime,
        streamUptimeMs: streamUptime,
        hasStream,
        streamActive,
        trackCount,
        errorCount: errorCountRef.current,
        loading,
        hasError: !!error,
        memory: memoryInfo
      });
    }, 30000); // Every 30 seconds
    
    return () => {
      const uptime = Date.now() - mountTimeRef.current;
      logger.info('fitness.video.unmounted', { 
        componentId,
        uptimeMs: uptime,
        errorCount: errorCountRef.current,
        hadError: !!error
      });
      
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
      
      // TELEMETRY: Check for orphaned streams
      if (webcamRef.current?.stream) {
        const tracks = webcamRef.current.stream.getTracks();
        if (tracks.length > 0) {
          logger.warn('fitness.video.orphaned_stream', {
            componentId,
            trackCount: tracks.length,
            tracksActive: tracks.filter(t => t.readyState === 'live').length
          });
        }
      }
    };
  }, [minimal, error, loading]);

  const videoConstraints = useMemo(() => ({ width: { ideal: 1280 }, height: { ideal: 720 } }), []);

  const handleStreamReady = useCallback(() => {
    const logger = getDaylightLogger();
    streamStartTimeRef.current = Date.now();
    const timeSinceMount = Date.now() - mountTimeRef.current;
    
    // TELEMETRY: Stream successfully started
    logger.info('fitness.video.stream_ready', {
      componentId: componentIdRef.current,
      timeSinceMountMs: timeSinceMount,
      hasWebcamRef: !!webcamRef.current,
      hasStream: !!webcamRef.current?.stream,
      trackCount: webcamRef.current?.stream?.getTracks?.().length || 0
    });
    
    setLoading(false);
    setError(null);
  }, []);

  const handleError = useCallback((err) => {
    const logger = getDaylightLogger();
    errorCountRef.current++;
    const timeSinceMount = Date.now() - mountTimeRef.current;
    const timeSinceStream = streamStartTimeRef.current ? Date.now() - streamStartTimeRef.current : null;
    
    // TELEMETRY: Stream error - critical for crash diagnosis
    logger.error('fitness.video.stream_error', {
      componentId: componentIdRef.current,
      errorMessage: err?.message || 'Unknown error',
      errorName: err?.name,
      errorCount: errorCountRef.current,
      timeSinceMountMs: timeSinceMount,
      timeSinceStreamMs: timeSinceStream,
      wasStreaming: !!streamStartTimeRef.current,
      // Capture memory state at error time
      memory: performance.memory ? {
        usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
      } : null
    });
    
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
