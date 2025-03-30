import React, { useState, useEffect } from 'react';

const TVApp = () => {
    const [screenInfo, setScreenInfo] = useState({
        width: window.innerWidth,
        height: window.innerHeight,
        userAgent: navigator.userAgent,
    });

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
        <div>
            <h1>TV App</h1>
            <p>Screen Width: {screenInfo.width}px</p>
            <p>Screen Height: {screenInfo.height}px</p>
            <p>Browser User Agent: {screenInfo.userAgent}</p>
            <WebcamViewer />
        </div>
    );
};


const WebcamViewer = () => {
    const [isCameraOn, setIsCameraOn] = useState(false);
    const videoRef = React.useRef(null);

    const handleStartCamera = async () => {
        if (!isCameraOn) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                }
                setIsCameraOn(true);
            } catch (error) {
                console.error("Error accessing webcam:", error);
            }
        }
    };

    return (
        <div>
            <button onClick={handleStartCamera}>
                {isCameraOn ? "Camera On" : "Start Camera"}
            </button>
            {isCameraOn && (
                <video
                    ref={videoRef}
                    style={{ width: "100%", marginTop: "10px" , border: '3px solid #FFF'}}
                    muted
                    autoPlay
                    playsInline
                />
            )}
        </div>
    );
};


export default TVApp;