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
        </div>
    );
};

export default TVApp;