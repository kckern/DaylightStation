import React, { useState } from 'react';
import TVMenu from './modules/TVMenu';
import './TVApp.scss';

const TVApp = () => {
    const initialMenuList = [
        { title: 'D&C', key: 'scripture', value: `d&c ${Math.floor(Math.random() * 132) + 1}` },
        { title: 'Did You Know', key: 'player', value: { plexId: 415974 } },
        { title: 'Bible', key: 'list', value: { plexId: '177777' } },
        { title: 'Crash Course Kids', key: 'list', value: { plexId: '375840' } },
        { title: 'Cooking', key: 'list', value: { plexId: '416408' } },
    ];

    // Use a state to track the current view/component
    const [currentComponent, setCurrentComponent] = useState(
        <TVMenu
            menuList={initialMenuList}
        />
    );

    return (
        <div className="tv-app-container">
            <div className="tv-app">
                {currentComponent}
            </div>
        </div>
    );
};

export default TVApp;