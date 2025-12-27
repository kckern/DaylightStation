import React, { useMemo } from 'react';
import { DaylightImagePath } from '../../lib/api.mjs';
import SidebarFooter from './SidebarFooter.jsx';
import { sortNavItems, getNavItemClasses, isNavItemActive } from './lib/navigationUtils';
import './FitnessNavbar.scss';

const FitnessNavbar = ({ 
  navItems = [],
  currentState = {},
  onNavigate 
}) => {
  const sortedItems = useMemo(() => sortNavItems(navItems), [navItems]);
  
  const getCollectionIcon = (icon) => {
    if (!icon) return null;
    return DaylightImagePath(`icons/${icon}.svg`);
  };

  const handleItemClick = (item) => {
    if (onNavigate) {
      onNavigate(item.type, item.target, item);
    }
  };

  return (
    <div className="fitness-navbar">
      <div className="navbar-header">
        {/* Reserved for future use */}
      </div>
      
      <nav className="navbar-nav">
        {sortedItems.length === 0 ? (
          <div className="loading-state">
            <div className="loading-icon">⏳</div>
          </div>
        ) : (
          sortedItems.map((item, index) => {
            const isActive = isNavItemActive(item, currentState);
            const classNames = getNavItemClasses(item, isActive);
            
            return (
              <button
                key={index}
                className={classNames}
                onPointerDown={() => handleItemClick(item)}
              >
                <div className="nav-icon">
                  {item.icon ? (
                    <img 
                      src={getCollectionIcon(item.icon)} 
                      alt={item.name}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'inline';
                      }}
                    />
                  ) : (
                    <span>📺</span>
                  )}
                  <span style={{display: 'none'}}>📺</span>
                </div>
                <span className="nav-label">{item.name}</span>
              </button>
            );
          })
        )}
      </nav>

      <SidebarFooter onContentSelect={onNavigate} />
    </div>
  );
};

export default FitnessNavbar;
