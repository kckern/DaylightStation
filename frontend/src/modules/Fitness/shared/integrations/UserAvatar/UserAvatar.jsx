import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '../../../components/CircularUserAvatar.jsx';

const UserAvatar = ({
  user,
  size = 'md',
  showHeartRate = true,
  showZone = true,
  showName = false,
  interactive = false,
  onClick,
  className,
  ...props
}) => {
  const sizeMap = {
    sm: 32,
    md: 48,
    lg: 64,
    xl: 96
  };

  const pxSize = sizeMap[size] || 48;

  return (
    <div 
      className={`user-avatar-wrapper ${interactive ? 'interactive' : ''} ${className || ''}`}
      onClick={interactive ? onClick : undefined}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      <CircularUserAvatar
        user={user}
        size={pxSize}
        showHeartRate={showHeartRate}
        showZoneRing={showZone}
        {...props}
      />
      {showName && user?.name && (
        <div className="user-avatar-name" style={{ fontSize: Math.max(10, pxSize / 4) }}>
          {user.name}
        </div>
      )}
    </div>
  );
};

UserAvatar.propTypes = {
  user: PropTypes.object,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  showHeartRate: PropTypes.bool,
  showZone: PropTypes.bool,
  showName: PropTypes.bool,
  interactive: PropTypes.bool,
  onClick: PropTypes.func,
  className: PropTypes.string
};

export default UserAvatar;
