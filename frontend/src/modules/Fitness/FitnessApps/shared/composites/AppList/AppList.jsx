import React from 'react';
import PropTypes from 'prop-types';
import { AppIconButton } from '../../primitives';
import './AppList.scss';

const AppList = ({
  items = [],
  renderItem,
  onItemClick,
  emptyMessage = 'No items found',
  loading = false,
  variant = 'default',
  className,
  ...props
}) => {
  const combinedClassName = [
    'app-list',
    `app-list--${variant}`,
    className
  ].filter(Boolean).join(' ');

  if (loading) {
    return (
      <div className={combinedClassName} {...props}>
        <div className="app-list__loading">Loading...</div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className={combinedClassName} {...props}>
        <div className="app-list__empty">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className={combinedClassName} {...props}>
      {items.map((item, index) => (
        <div 
          key={item.id || index} 
          className={`app-list__item ${onItemClick ? 'app-list__item--interactive' : ''}`}
          onClick={() => onItemClick?.(item)}
        >
          {renderItem ? renderItem(item, index) : (
            <>
              {item.icon && <div className="app-list__item-icon">{item.icon}</div>}
              <div className="app-list__item-content">
                <div className="app-list__item-title">{item.title || item.label}</div>
                {item.subtitle && <div className="app-list__item-subtitle">{item.subtitle}</div>}
              </div>
              {item.action && <div className="app-list__item-action">{item.action}</div>}
              {onItemClick && !item.action && (
                <div className="app-list__item-arrow">›</div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
};

AppList.propTypes = {
  items: PropTypes.array,
  renderItem: PropTypes.func,
  onItemClick: PropTypes.func,
  emptyMessage: PropTypes.node,
  loading: PropTypes.bool,
  variant: PropTypes.oneOf(['default', 'inset', 'cards']),
  className: PropTypes.string
};

export default AppList;
