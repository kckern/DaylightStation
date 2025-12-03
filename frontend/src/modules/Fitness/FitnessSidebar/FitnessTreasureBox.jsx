import React, { useState, useEffect } from 'react';
import '../FitnessCam.scss';

// Lightweight treasure box summary component
const FitnessTreasureBox = ({ box, session }) => {
  const [tick, setTick] = useState(Date.now());
  // Update every second while active
  // Start ticking when either treasure box start or session start is present
  const startTime = session?.startTime || session?.startedAt || null;
  useEffect(() => {
    if (!startTime) return; // wait until we have a start
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (!box) return null;
  // Recompute elapsed locally so we aren't dependent on a stale snapshot object
  const elapsed = startTime
    ? Math.floor((Date.now() - startTime) / 1000)
    : (session?.durationSeconds || 0);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const totalCoins = box.totalCoins ?? 0;
  const colorCoins = box.buckets || {};
  // Rank colors by zone intensity: fire (red) > hot (orange) > warm (yellow) > active (green) > cool (blue)
  const colorRank = (cRaw) => {
    if (!cRaw) return 0;
    const c = String(cRaw).toLowerCase();
    // Support both named colors and hex/rgba via substring signatures
    if (c.includes('ff6b6b') || c === 'red') return 500;      // fire
    if (c.includes('ff922b') || c === 'orange') return 400;   // hot
    if (c.includes('ffd43b') || c === 'yellow') return 300;   // warm
    if (c.includes('51cf66') || c === 'green') return 200;    // active
    if (c.includes('6ab8ff') || c === 'blue') return 100;     // cool
    return 0; // unknown / leftover
  };
  const colors = Object.keys(colorCoins)
    .filter(c => (colorCoins[c] || 0) > 0)
    .sort((a,b) => colorRank(b) - colorRank(a));
  const hasCoins = colors.length > 0;

  // Consistent hex mapping for semantic color names (match zone styling palette)
  const colorHexMap = {
    red: '#ff6b6b',      // fire
    orange: '#ff922b',   // hot
    yellow: '#ffd43b',   // warm
    green: '#51cf66',    // active
    blue: '#6ab8ff'      // cool
  };

  return (
    <div className="treasure-box-panel">
      <div className="tb-row tb-row-head">
        <h3>Treasure Box</h3>
        <div className="tb-timer" title={`Started: ${startTime ? new Date(startTime).toLocaleTimeString() : 'N/A'}`}>{mm}:{ss}</div>
      </div>
      <div className="tb-row tb-row-body">
        <div className="tb-total">
          <span className="tb-icon" role="img" aria-label="coins">💰</span>
          {totalCoins}
        </div>
        {hasCoins && (
          <div className="tb-color-grid">
            {colors.map(c => {
              const hex = colorHexMap[c] || c; // fallback to original if unexpected key
              return (
                <div key={c} className="tb-color-coin" title={`${c}: ${colorCoins[c]} coins`}>
                  <span className="swatch" style={{ background: hex }}>
                    {colorCoins[c]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FitnessTreasureBox;
