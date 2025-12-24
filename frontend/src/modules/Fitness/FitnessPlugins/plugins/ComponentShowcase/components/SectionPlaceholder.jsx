import React from 'react';

const SectionPlaceholder = ({ title, description, items = [], statusLabel = 'Placeholder', badge }) => {
  return (
    <div className="cs-placeholder">
      <div className="cs-placeholder-header">
        <span className="cs-placeholder-status">{statusLabel}</span>
        {badge && <span className="cs-placeholder-badge">{badge}</span>}
      </div>
      <h2 className="cs-placeholder-title">{title}</h2>
      {description && <p className="cs-placeholder-description">{description}</p>}
      {items.length > 0 && (
        <ul className="cs-placeholder-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <div className="cs-placeholder-footnote">Detailed demos land in later phases.</div>
    </div>
  );
};

export default SectionPlaceholder;
