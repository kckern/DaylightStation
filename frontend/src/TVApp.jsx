import React, { useState, useEffect, useRef } from 'react';
import Scriptures from './modules/Scriptures';
import TVMenu from './modules/TVMenu';
import './TVApp.scss';
import Player from './modules/Player';

function TVApp() {

    const [selection, setSelection] = useState('');
    const [selectionKey, setSelectionKey] = useState(null);
    const [selectionValue, setSelectionValue] = useState(null);

    useEffect(() => {
        if (selection) {
            if (typeof selection === 'string') {
                setSelectionKey(selection);
                setSelectionValue(null);
            } else {
                const key = Object.keys(selection)[0];
                setSelectionKey(key);
                setSelectionValue(selection[key]);
            }
        } else {
            setSelectionKey(null);
            setSelectionValue(null);
        }
    }, [selection]);
    const getSelectionContent = (key, value = {}) => {
        if (!selection) return <TVMenu setSelection={setSelection}  menuList={[]} />;
        const selectionMap = {
            'A': <Scriptures media={`d&c ${Math.floor(Math.random() * 132) + 1}`} advance={() => setSelection(null)} />,
            'B': <Player queue={[{ key: 'plex', value: 415974 }]} setQueue={() => {}} advance={() => setSelection(null)} />,
            'C': <TVMenu menuList={{ plex: '177777' }} setSelection={setSelection} />,
            'D': <TVMenu menuList={{ plex: '415974' }} setSelection={setSelection} />,
            'plex': <Player queue={[{ key: 'plex', value }]} setQueue={() => {}} advance={() => setSelection(null)} />,
        };

        return selectionMap[key] || <TVMenu setSelection={setSelection} />;
    };

    const selectedContent = getSelectionContent(selectionKey, selectionValue);


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

    const appRef = useRef(null);
    return (
        <div className="tv-app-container">
            <div className="tv-app" ref={appRef}>
                {React.cloneElement(selectedContent, { appRef, setSelection })}
            </div>
        </div>
    );
}



export default TVApp;
