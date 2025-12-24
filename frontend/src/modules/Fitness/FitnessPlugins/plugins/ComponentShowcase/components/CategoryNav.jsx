import React from 'react';

const CategoryNav = ({ tabs = [], activeTab, onChange }) => {
  return (
    <nav className="cs-nav" aria-label="Component showcase sections">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            className={`cs-nav-item ${isActive ? 'active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange?.(tab.id)}
          >
            <span className="cs-nav-label">{tab.label}</span>
            {tab.meta && <span className="cs-nav-meta">{tab.meta}</span>}
          </button>
        );
      })}
    </nav>
  );
};

export default CategoryNav;
