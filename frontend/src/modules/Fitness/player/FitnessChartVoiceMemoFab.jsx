import React from 'react';

const FitnessChartVoiceMemoFab = ({ sessionActive, onRecord }) => {
  if (!sessionActive) return null;
  return (
    <button
      type="button"
      className="fitness-player__voice-memo-fab"
      onClick={onRecord}
      aria-label="Record voice memo"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );
};

export default FitnessChartVoiceMemoFab;
