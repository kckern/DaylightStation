import React from 'react';
import './FitnessSidebar.scss';

const FitnessSidebar = ({ collections = [], activeCollection, onCollectionChange }) => {

  const getCollectionIcon = (name) => {
    switch (name.toLowerCase()) {
      case 'favorites':
        return '⭐';
      case 'kids':
        return '👶';
      case 'cardio':
        return '❤️';
      default:
        return '📺';
    }
  };

  return (
    <div className="fitness-sidebar">
      <div className="sidebar-header">
        
      </div>
      
      <nav className="sidebar-nav">
        {collections.length === 0 ? (
          <div className="loading-state">
            <div className="loading-icon">⏳</div>
          </div>
        ) : (
          collections.map((collection, index) => (
            <button
              key={collection.id || index}
              className={`nav-item ${String(activeCollection) === String(collection.id) ? 'active' : ''}`}
              onClick={() => onCollectionChange && onCollectionChange(collection)}
            >
              <div className="nav-icon">{getCollectionIcon(collection.name)}</div>
              <span className="nav-label">{collection.name}</span>
            </button>
          ))
        )}
      </nav>
      
    </div>
  );
};

export default FitnessSidebar;