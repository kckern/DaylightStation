import { useMemo, useState, useEffect, useCallback } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../../lib/api.mjs';
import './FamilySelector.scss';

/**
 * FamilySelector - Roulette wheel for selecting household members
 * 
 * Props:
 * - winner: Rig the winner (member id)
 * - title: Override wheel title
 * - exclude: Comma-separated member ids to exclude
 * - autoSpin: Automatically spin on mount
 */

// Spin configuration
const SPIN_CONFIG = {
  minSpins: 3,
  maxSpins: 6,
  durationMs: 8000,
};

// Wheel states
const WHEEL_STATE = {
  IDLE: 'idle',
  SPINNING: 'spinning',
  RESULT: 'result',
};

// Default colors for wheel segments
const SEGMENT_COLORS = [
  '#4A90D9', // Blue
  '#D94A6A', // Pink
  '#6AD94A', // Green
  '#D9A64A', // Orange
  '#9B59B6', // Purple
  '#1ABC9C', // Teal
  '#E74C3C', // Red
  '#F39C12', // Yellow
];

const DEFAULT_TITLE = "Whose turn is it?";

/**
 * Get avatar URL for a user
 */
const getAvatarSrc = (userId) => {
  return DaylightMediaPath(`/media/img/users/${userId || 'user'}`);
};

/**
 * Get initials from a name (e.g., "Alice" -> "A", "Bob Smith" -> "BS")
 */
function getInitials(name) {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Generate SVG path for a pie segment
 */
function getSegmentPath(index, total, radius, cx, cy) {
  const anglePerSegment = (2 * Math.PI) / total;
  const startAngle = index * anglePerSegment - Math.PI / 2;
  const endAngle = startAngle + anglePerSegment;

  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);

  const largeArcFlag = anglePerSegment > Math.PI ? 1 : 0;

  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
}

/**
 * Calculate the rotation angle needed to land on a specific segment
 * @param {number} winnerIndex - Index of the winning segment
 * @param {number} total - Total number of segments
 * @param {number} currentRotation - Current wheel rotation in degrees
 */
function calculateSpinAngle(winnerIndex, total, currentRotation = 0) {
  const segmentAngle = 360 / total;
  // Target: the angle where this segment's center aligns with the pointer (top)
  const segmentCenter = winnerIndex * segmentAngle + segmentAngle / 2;
  const targetRotation = 360 - segmentCenter;
  
  // Calculate how much more we need to rotate from current position
  const currentMod = ((currentRotation % 360) + 360) % 360;
  const targetMod = ((targetRotation % 360) + 360) % 360;
  let offset = targetMod - currentMod;
  if (offset < 0) offset += 360;
  
  // Add full spins for dramatic effect
  const fullSpins = SPIN_CONFIG.minSpins + Math.random() * (SPIN_CONFIG.maxSpins - SPIN_CONFIG.minSpins);
  const finalAngle = Math.floor(fullSpins) * 360 + offset;
  
  return finalAngle;
}

/**
 * Calculate position for avatar/text within a segment
 */
function getSegmentCenter(index, total, radius, cx, cy) {
  const anglePerSegment = (2 * Math.PI) / total;
  const midAngle = index * anglePerSegment + anglePerSegment / 2 - Math.PI / 2;
  const labelRadius = radius * 0.6;

  return {
    x: cx + labelRadius * Math.cos(midAngle),
    y: cy + labelRadius * Math.sin(midAngle),
  };
}

/**
 * Wheel Segment Component
 */
function WheelSegment({ member, index, total, radius, cx, cy, isWinner, rotation, isSpinning }) {
  const path = getSegmentPath(index, total, radius, cx, cy);
  const center = getSegmentCenter(index, total, radius, cx, cy);
  const initials = getInitials(member.name);
  const [imgError, setImgError] = useState(false);
  const avatarSize = 90;
  const half = avatarSize / 2;

  const handleImageError = () => {
    setImgError(true);
  };

  const avatarStyle = {
    transformOrigin: `${center.x}px ${center.y}px`,
    transform: `rotate(${-rotation}deg)`,
    transition: isSpinning
      ? `transform ${SPIN_CONFIG.durationMs}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)`
      : 'none',
  };

  return (
    <g className={`wheel-segment ${isWinner ? 'winner' : ''}`}>
      <path d={path} fill={member.color} stroke="#fff" strokeWidth="2" />
      <g className="avatar-wrapper" style={avatarStyle}>
        {/* Border circle */}
        <circle
          cx={center.x}
          cy={center.y}
          r={half}
          fill="none"
          stroke="#000"
          strokeWidth="3"
        />
        {member.avatar && !imgError ? (
          <image
            href={member.avatar}
            x={center.x - half}
            y={center.y - half}
            width={avatarSize}
            height={avatarSize}
            clipPath={`circle(${half}px)`}
            className="segment-avatar"
            preserveAspectRatio="xMidYMid slice"
            onError={handleImageError}
          />
        ) : (
          <text
            x={center.x}
            y={center.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="segment-initials"
            fill="#fff"
            fontSize="32"
            fontWeight="bold"
          >
            {initials}
          </text>
        )}
      </g>
    </g>
  );
}

/**
 * Roulette Wheel Component
 */
function RouletteWheel({ members, rotation, isSpinning, winnerIndex, showResult }) {
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 10;

  const wheelStyle = {
    transform: `rotate(${rotation}deg)`,
    '--wheel-rotation': `${rotation}deg`,
    transition: isSpinning
      ? `transform ${SPIN_CONFIG.durationMs}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)`
      : 'none',
  };

  // Calculate flick timing: time for one segment to pass
  const segmentPassDuration = (SPIN_CONFIG.durationMs / ((rotation || 1) / 360)) * (360 / members.length);
  const pointerStyle = {
    '--flick-duration': `${segmentPassDuration}ms`,
  };

  return (
    <>
      <div className={`wheel-pointer ${isSpinning ? 'flicking' : ''}`} style={pointerStyle}>▼</div>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className={`roulette-wheel ${isSpinning ? 'spinning' : ''} ${showResult ? 'show-result' : ''}`}
        width={size}
        height={size}
      >
        <g className="wheel-segments" style={wheelStyle}>
        {members.map((member, index) => (
          <WheelSegment
            key={member.id}
            member={member}
            index={index}
            total={members.length}
            radius={radius}
            cx={cx}
            cy={cy}
            isWinner={showResult && index === winnerIndex}
            rotation={rotation}
            isSpinning={isSpinning}
          />
        ))}
        <circle cx={cx} cy={cy} r={30} fill="#333" stroke="#fff" strokeWidth="3" />
      </g>
    </svg>
    </>
  );
}

/**
 * Inner FamilySelector Component (after data is loaded)
 */
function FamilySelectorInner({ members, winner, title, exclude }) {
  const riggedWinner = winner || null;
  const displayTitle = title || DEFAULT_TITLE;
  const excludeList = (exclude || '')
    .split(',')
    .filter(Boolean);

  // Filter members based on exclusions
  const activeMembers = useMemo(
    () => members.filter(m => !excludeList.includes(m.id)),
    [members, excludeList]
  );

  // Spin state
  const [wheelState, setWheelState] = useState(WHEEL_STATE.IDLE);
  const [rotation, setRotation] = useState(0);
  const [winnerIndex, setWinnerIndex] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);

  /**
   * Select the winner (rigged or random)
   */
  const selectWinner = useCallback(() => {
    let index, member;
    if (riggedWinner) {
      index = activeMembers.findIndex(m => m.id === riggedWinner);
      if (index !== -1) {
        member = activeMembers[index];
      }
    }
    if (!member) {
      index = Math.floor(Math.random() * activeMembers.length);
      member = activeMembers[index];
    }
    return { index, member };
  }, [activeMembers, riggedWinner]);

  /**
   * Start the spin
   */
  const spin = useCallback(() => {
    if (wheelState !== WHEEL_STATE.IDLE) return;

    const { index, member } = selectWinner();
    const angle = calculateSpinAngle(index, activeMembers.length, rotation);
    
    setWinnerIndex(index);
    setSelectedMember(member);
    setRotation(prev => prev + angle);
    setWheelState(WHEEL_STATE.SPINNING);

    setTimeout(() => {
      setWheelState(WHEEL_STATE.RESULT);
    }, SPIN_CONFIG.durationMs);
  }, [wheelState, selectWinner, activeMembers.length, rotation]);

  /**
   * Keyboard event handler
   */
useEffect(() => {
    const handleKeyDown = (e) => {
        // Space, Enter, or NVIDIA Shield Play/Center button
        const isPlayButton = e.code === 'Space' || e.code === 'Enter' || e.code === 'MediaPlayPause' || e.keyCode === 13;
        // Arrow keys (left/right)
        const isArrowKey = e.code === 'ArrowLeft' || e.code === 'ArrowRight';
        
        if ((isPlayButton || isArrowKey) && wheelState === WHEEL_STATE.IDLE) {
            e.preventDefault();
            spin();
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
}, [wheelState, spin]);

  // Disable if < 2 members
  if (activeMembers.length < 2) {
    return (
      <div className="family-selector family-selector-disabled">
        <div className="disabled-message">
          <h2>Not enough members</h2>
          <p>At least 2 members are required to spin the wheel.</p>
        </div>
      </div>
    );
  }

  const getInstructionText = () => {
    switch (wheelState) {
      case WHEEL_STATE.SPINNING:
        return 'Spinning...';
      case WHEEL_STATE.RESULT:
        return 'Press SPACE to spin again!';
      default:
        return 'Press SPACE to spin!';
    }
  };

  return (
    <div className="family-selector" data-state={wheelState}>
      <div className="family-selector-container">

        <div className="wheel-wrapper">
          <RouletteWheel
            members={activeMembers}
            rotation={rotation}
            isSpinning={wheelState === WHEEL_STATE.SPINNING}
            winnerIndex={winnerIndex}
            showResult={wheelState === WHEEL_STATE.RESULT}
          />
        </div>

      </div>

      {/* Winner Modal */}
      {wheelState === WHEEL_STATE.RESULT && selectedMember && (
        <div className="winner-modal-overlay">
          <div className="winner-modal">
            <div className="winner-avatar">
              <img
                src={selectedMember.avatar}
                alt={selectedMember.name}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <span className="winner-initials">{getInitials(selectedMember.name)}</span>
            </div>
            <h2 className="winner-name">{selectedMember.name}</h2>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main FamilySelector Container (Bootstrap + Loading)
 */
export default function FamilySelector({ winner, title, exclude, autoSpin }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      // Use the gratitude bootstrap endpoint which returns household users
      const data = await DaylightAPI('/api/gratitude/bootstrap');
      
      // Transform users to members with colors and avatars
      const users = data.users || [];
      const transformedMembers = users.map((user, index) => ({
        id: user.id,
        name: user.group_label || user.display_name || user.name || user.id,
        color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
        avatar: getAvatarSrc(user.id),
      }));
      
      setMembers(transformedMembers);
      setError(null);
    } catch (e) {
      console.error('FamilySelector: Failed to load members', e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  if (loading) {
    return (
      <div className="family-selector family-selector-loading">
        <div className="loading-message">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="family-selector family-selector-error">
        <div className="error-message">
          <h2>Error</h2>
          <p>Failed to load household members.</p>
        </div>
      </div>
    );
  }

  return (
    <FamilySelectorInner
      members={members}
      winner={winner}
      title={title}
      exclude={exclude}
    />
  );
}
