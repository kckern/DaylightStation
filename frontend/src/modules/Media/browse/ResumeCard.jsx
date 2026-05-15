import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

function formatTime(seconds) {
  const m = Math.floor((seconds ?? 0) / 60);
  const s = Math.floor((seconds ?? 0) % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ResumeCard() {
  const { snapshot, transport } = useSessionController('local');
  const item = snapshot?.currentItem;
  if (!item) return null;
  if (snapshot.state === 'idle') return null;

  return (
    <div data-testid="resume-card" className="resume-card">
      <div className="resume-card-label">Resume</div>
      <div className="resume-card-title">{item.title ?? item.contentId}</div>
      <div className="resume-card-position">at {formatTime(snapshot.position)}</div>
      <button
        data-testid="resume-play"
        className="resume-card-btn"
        onClick={() => transport.play?.()}
      >
        ▶ Resume
      </button>
    </div>
  );
}

export default ResumeCard;
