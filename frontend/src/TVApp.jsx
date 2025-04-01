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
        'B': <Player queue={[{ key: 'plex', value: 616001 }]} setQueue={() => {}} advance={() => setSelection(null)} />,
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



export default TVApp;
