import React, { useState, useEffect, useRef } from 'react';
import Scriptures from './modules/Scriptures';
import TVMenu from './modules/TVMenu';
import './TVApp.scss';
import Player from './modules/Player';

function TVApp() {

    const [selection, setSelection] = useState(null);
    const [active, setActive] = useState(false);

    const selectionMap = {
        'A': <Scriptures media={`d&c ${Math.floor(Math.random() * 132) + 1}` } advance={() => setSelection(null)} />,
        'B': <Player queue={[{ key: 'plex', value: 489490 }]} setQueue={() => {}} advance={() => setSelection(null)} />,
    }



    const selectedContent = selectionMap[selection] ? selectionMap[selection] : <TVMenu setSelection={setSelection} />;
    // Clear selection on escape
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setSelection(null);
            } else if (event.key === 'Enter') {
                setSelection(null); // Example: Handle Enter key if needed
            }
        };

        const handleBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = ''; // Required for some browsers
            setSelection(null);
        };

        const handlePopState = () => {
            setSelection(null);
            window.history.pushState(null, '', window.location.href); // Prevent back navigation
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('popstate', handlePopState);

        // Push initial state to prevent back navigation
        window.history.pushState(null, '', window.location.href);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);


    return (
        <div  className="tv-app-container" >
            <div className="tv-app"> 
                {selectedContent}
            </div>
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
