import React from 'react';
import { DaylightImagePath } from '../../lib/api.mjs';
import SidebarFooter from './SidebarFooter.jsx';
import './FitnessNavbar.scss';

const FitnessNavbar = ({ collections = [], activeCollection, onContentSelect }) => {

  const getCollectionIcon = (icon) => {
    if (!icon) return null;
    const iconUrl = DaylightImagePath(`icons/${icon}.svg`);
    console.log('Generated icon URL:', iconUrl);
    return iconUrl;
  };

  return (
    <div className="fitness-navbar">
      <div className="navbar-header">
        
      </div>
      
      <nav className="navbar-nav">
        {collections.length === 0 ? (
          <div className="loading-state">
            <div className="loading-icon">⏳</div>
          </div>
        ) : (
          collections.map((collection, index) => (
            <button
              key={collection.id || index}
              className={`nav-item ${String(activeCollection) === String(collection.id) ? 'active' : ''}`}
              onPointerDown={() => onContentSelect && onContentSelect('collection', collection)}
            >
              <div className="nav-icon">
                {collection.icon ? (
                  <img 
                    src={getCollectionIcon(collection.icon)} 
                    alt={collection.name}
                    onError={(e) => {
                      console.error('Failed to load icon:', collection.icon, e.target.src);
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'inline';
                    }}
                  />
                ) : (
                  <span>📺</span>
                )}
                <span style={{display: 'none'}}>📺</span>
              </div>
              <span className="nav-label">{collection.name}</span>
            </button>
          ))
        )}
      </nav>

      <SidebarFooter onContentSelect={onContentSelect} />

    </div>
  );
};

export default FitnessNavbar;
