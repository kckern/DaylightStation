import React from 'react';
import PropTypes from 'prop-types';
import UserAvatar from '../UserAvatar';
import './UserAvatarGrid.scss';

const UserAvatarGrid = ({
  users = [],
  maxVisible = 6,
  size = 'md',
  layout = 'row',
  onUserClick,
  showOverflow = true,
  className,
  ...props
}) => {
  const visibleUsers = users.slice(0, maxVisible);
  const overflowCount = Math.max(0, users.length - maxVisible);

  return (
    <div className={`user-avatar-grid user-avatar-grid--${layout} ${className || ''}`} {...props}>
      {visibleUsers.map((user) => (
        <UserAvatar
          key={user.id || user.userId}
          user={user}
          size={size}
          interactive={!!onUserClick}
          onClick={() => onUserClick?.(user)}
        />
      ))}
      
      {showOverflow && overflowCount > 0 && (
        <div className={`user-avatar-overflow user-avatar-overflow--${size}`}>
          +{overflowCount}
        </div>
      )}
    </div>
  );
};

UserAvatarGrid.propTypes = {
  users: PropTypes.array,
  maxVisible: PropTypes.number,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  layout: PropTypes.oneOf(['row', 'grid', 'stack']),
  onUserClick: PropTypes.func,
  showOverflow: PropTypes.bool,
  className: PropTypes.string
};

export default UserAvatarGrid;
