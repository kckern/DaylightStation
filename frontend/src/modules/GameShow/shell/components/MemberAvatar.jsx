import React, { useState } from 'react';
import { onColor } from '../teams/teamColors.js';
import './MemberAvatar.scss';

// A member's face across GameShow surfaces. Falls back to the member's first
// initial on the team color when there's no avatar image (guests, or a 404).
export function MemberAvatar({ member, teamColor = '#888', size = 40, showName = false, className = '' }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = member?.name || '';
  const initial = (name.trim()[0] || '?').toUpperCase();
  const useImg = member?.avatar && !imgFailed;
  const style = { '--ma-size': `${size}px`, '--team-color': teamColor, '--team-on': onColor(teamColor) };
  return (
    <span className={`gs-avatar ${className}`.trim()} style={style} title={name}>
      <span className="gs-avatar__disc">
        {useImg ? (
          <img className="gs-avatar__img" src={member.avatar} alt={name} onError={() => setImgFailed(true)} />
        ) : (
          <span className="gs-avatar__initial" aria-hidden="true">{initial}</span>
        )}
      </span>
      {showName && <span className="gs-avatar__name">{name}</span>}
    </span>
  );
}
export default MemberAvatar;
