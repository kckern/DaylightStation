import React, { useState, useEffect, createContext, useContext } from 'react';
import TVMenu from './modules/TVMenu';
import './TVApp.scss';

const BackFunctionContext = createContext();

export const BackFunctionProvider = ({ children }) => {
    const [backFunction, setBackFunction] = useState(()=>{});

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
        const handlePopState = (event) => {
            event.preventDefault();
            if (typeof backFunction === 'function') {
                backFunction();
            }
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [backFunction]);

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