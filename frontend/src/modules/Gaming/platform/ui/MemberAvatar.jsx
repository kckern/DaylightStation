import React, { useState } from 'react';
import { NEUTRAL_TEAM_COLOR, onColor } from './teamColors.js';
import './MemberAvatar.scss';

// A member's face across PartyGames surfaces. Falls back to the member's first
// initial on the team color when there's no avatar image (guests, or a 404).
export function MemberAvatar({ member, teamColor = NEUTRAL_TEAM_COLOR, size = 40, showName = false, className = '' }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = member?.name || '';
  const initial = (name.trim()[0] || '?').toUpperCase();
  const useImg = member?.avatar && !imgFailed;
  const style = { '--ma-size': `${size}px`, '--team-color': teamColor, '--team-on': onColor(teamColor) };
  return (
    <span className={`gp-avatar ${className}`.trim()} style={style} title={name}>
      <span className="gp-avatar__disc">
        {useImg ? (
          <img className="gp-avatar__img" src={member.avatar} alt={name} onError={() => setImgFailed(true)} />
        ) : (
          <span className="gp-avatar__initial" aria-hidden="true">{initial}</span>
        )}
      </span>
      {showName && <span className="gp-avatar__name">{name}</span>}
    </span>
  );
}
export default MemberAvatar;
