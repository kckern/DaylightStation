import React, { useState, useEffect, createContext, useContext } from 'react';
import TVMenu from './modules/TVMenu';
import './TVApp.scss';

const BackFunctionContext = createContext();

export const BackFunctionProvider = ({ children }) => {
    const [backFunction, setBackFunction] = useState(() => () => alert("Back!"));

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
        { title: 'Bible Project', key: 'player', value: { plexId: 463232, rate: 1 } },
        { title: 'Bible', key: 'list', value: { plexId: '177777' } },
        { title: 'Crash Course Kids', key: 'list', value: { plexId: '375840' } },
        { title: 'Cooking', key: 'list', value: { plexId: '416408' } },
        { title: 'Classical', key: 'player', value: { plexId: '489862', rate: 1 } },
    ];

    const [currentComponent, setCurrentComponent] = useState(
        <TVMenu
            menuList={initialMenuList}
            setBackFunction={setBackFunction}
        />
    );

    useEffect(() => {
        const handlePopState = (event) => {
            event.preventDefault();
            if (backFunction) {
                backFunction();
                // Push a new state to re-hijack the back button
                window.history.pushState(null, '', window.location.href);
                return false; // Prevent the default action
            }
            return false; // Prevent the default action
        };

        const handleBeforeUnload = (event) => {
            if (backFunction) {
                event.preventDefault();
                event.returnValue = ''; // Required for some browsers to show the confirmation dialog
                backFunction();
                window.history.pushState(null, '', window.location.href);
                return false; // Prevent the default action
            }
            return false; // Prevent the default action
        };

        // Push initial state to prevent back navigation
        window.history.pushState(null, '', window.location.href);

        window.addEventListener('popstate', handlePopState);
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            window.removeEventListener('beforeunload', handleBeforeUnload);
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
