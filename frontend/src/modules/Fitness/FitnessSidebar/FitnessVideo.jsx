import React, { useEffect, useRef, useState } from 'react';
import '../FitnessUsers.scss';

const FitnessVideo = ({ minimal = false }) => {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const streamRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const startWebcam = async () => {
      try {
        setLoading(true);
        setError(null);

        // Request access to the first available webcam
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        if (!mounted) {
          // Component unmounted, stop the stream
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setLoading(false);
      } catch (err) {
        console.error('Error accessing webcam:', err);
        if (mounted) {
          setError(err.message || 'Failed to access webcam');
          setLoading(false);
        }
      }
    };

    startWebcam();

    // Cleanup function
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
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
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="fitness-video-feed"
          style={{ 
            display: loading || error ? 'none' : 'block',
            ...(minimal ? { 
              width: '100%', 
              height: '100%', 
              objectFit: 'cover',
              margin: 0,
              padding: 0
            } : {})
          }}
        />
      </div>
    </div>
  );
};

export default FitnessVideo;
