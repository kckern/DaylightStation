import React, { useState, useEffect, useRef } from 'react';

function TVApp() {
    const [screenInfo, setScreenInfo] = useState({
        width: window.innerWidth,
        height: window.innerHeight,
        userAgent: navigator.userAgent,
    });

    // Keep track of window resizing
    useEffect(() => {
        const handleResize = () => {
            setScreenInfo({
                width: window.innerWidth,
                height: window.innerHeight,
                userAgent: navigator.userAgent,
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
            <h1>TV App</h1>
            <p>Screen Width: {screenInfo.width}px</p>
            <p>Screen Height: {screenInfo.height}px</p>
            <p>Browser User Agent: {screenInfo.userAgent}</p>
            <WebcamViewer />
        </div>
    );
}

function WebcamViewer() {
    const [isCameraOn, setIsCameraOn] = useState(false);
    const videoRef = useRef(null);

    const handleStartCamera = async () => {
        if (!isCameraOn) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    // Ensure play() is triggered from a user gesture, and handle any promise rejections
                    await videoRef.current.play();
                    setIsCameraOn(true);
                }
            } catch (error) {
                console.error('Error accessing webcam:', error);
            }
        }
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Enter') {
                handleStartCamera();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isCameraOn]);

    return (
        <div style={{ marginTop: '20px' }}>
            <button onClick={handleStartCamera} style={{ padding: '10px 20px', fontSize: '16px' }}>
                {isCameraOn ? 'Camera On' : 'Start Camera'}
            </button>

            {/* A container with fixed size so the video is clearly visible */}
            <div
                style={{
                    marginTop: '20px',
                    width: '640px',
                    height: '480px',
                    border: '2px solid #ccc',
                    display: 'inline-block',
                    position: 'relative',
                    background: '#000', // optional, so it’s clearly visible
                }}
            >
                {/* The video takes full container size */}
                <video
                    ref={videoRef}
                    muted
                    autoPlay
                    playsInline
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: isCameraOn ? 'block' : 'none',
                    }}
                />
            </div>
        </div>
    );
}

export default TVApp;
