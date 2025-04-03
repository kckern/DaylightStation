import React, { useState, useEffect, createContext, useContext } from 'react';
import TVMenu from './modules/TVMenu';
import './TVApp.scss';

const BackFunctionContext = createContext();

export const BackFunctionProvider = ({ children }) => {
    const [backFunction, setBackFunction] = useState(()=>{alert('No back function set')});

    return (
        <BackFunctionContext.Provider value={{ backFunction, setBackFunction }}>
            {children}
        </BackFunctionContext.Provider>
    );
};

export const useBackFunction = () => useContext(BackFunctionContext);

const TVApp = () => {
    const { backFunction, setBackFunction } = useBackFunction();

    const initialMenuList = [
        { title: 'D&C', key: 'scripture', value: `d&c ${Math.floor(Math.random() * 132) + 1}` },
        { title: 'Did You Know', key: 'player', value: { plexId: 415974 } },
        { title: 'Bible', key: 'list', value: { plexId: '177777' } },
        { title: 'Crash Course Kids', key: 'list', value: { plexId: '375840' } },
        { title: 'Cooking', key: 'list', value: { plexId: '416408' } },
    ];

    const [currentComponent, setCurrentComponent] = useState(
        <TVMenu
            menuList={initialMenuList}
            setBackFunction={setBackFunction}
        />
    );


    useEffect(() => {
        const handleBeforeUnload = (event) => {
            event.preventDefault();
            event.returnValue = ''; // Required for some browsers
            backFunction();
        };
        const handlePopState = () => {
            backFunction();
            window.history.pushState(null, '', window.location.href); // Prevent back navigation
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('popstate', handlePopState);
        // Push initial state to prevent back navigation
        window.history.pushState(null, '', window.location.href);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    return (
        <div className="tv-app-container">
            <div className="tv-app">
                {currentComponent}
            </div>
        </div>
    );
};

export default () => (
    <BackFunctionProvider>
        <TVApp />
    </BackFunctionProvider>
);