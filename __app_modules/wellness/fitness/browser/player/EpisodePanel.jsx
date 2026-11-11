import React, { useEffect, useRef } from 'react';
import { normalizeImageUrl } from '@/lib/api.mjs';
import { TouchButton } from '@/lib/ui/TouchButton.jsx';
import { completionRows, whenInWords } from '../lib/episodeHistory.js';
import { RiderAvatar } from './EpisodeHistory.jsx';
import EpisodeStillsRail from './EpisodeStillsRail.jsx';

// The show screen's left column: what is inside the focused episode.
// Top to bottom — the rail (season poster + a carousel of stills from inside
// the episode), the title, the blurb, Play / Resume + Start over, and the
// history: each time it was actually done (who, when in words, and the
// circumstances). Nobody is listed for not having done it. Read at bike
// distance: nothing under 16px; everything solid — no dimming, no crop.

// Kiosk icons are SVG, never glyphs (fonts render them inconsistently).
const PlayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
);
const RestartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v5h5" />
  </svg>
);
const LockGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const clock = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Whole minutes, as the grid's duration badge shows them.
const minutesLabel = (seconds) => `${Math.max(1, Math.round(seconds / 60))} min`;

const names = (riders) => {
  const list = riders.map((r) => r.displayName);
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
};

const HistoryRow = ({ row, now }) => {
  const facts = [
    row.minutes != null ? `${row.minutes} min` : null,
    row.rings != null ? `${row.rings} rings` : null,
    row.otherVideos > 0 ? `${row.otherVideos} other ${row.otherVideos === 1 ? 'video' : 'videos'}` : null,
  ].filter(Boolean);
  return (
    <li className="episode-history__row">
      <span className="episode-history__avatars">
        {row.riders.map((r) => <RiderAvatar key={r.id} rider={r} className="episode-history__avatar" />)}
      </span>
      <span className="episode-history__who">{names(row.riders)}</span>
      <span className="episode-history__when">{whenInWords(row.startTime, now)}</span>
      {facts.length > 0 && <span className="episode-history__facts">{facts.join(' · ')}</span>}
    </li>
  );
};

export default function EpisodePanel({
  episode,
  showTitle,
  seasonImage = null,
  historyFor,
  household = [],
  resumeSeconds = 0,
  onPlay,
  locked = false,
  onUnlock = null,
  headerExtras = null,
  now = Date.now(),
}) {
  const focusedKey = episode ? (episode.plex || episode.id) : null;
  // The panel follows the focus: a new episode starts at the top.
  const panelRef = useRef(null);
  useEffect(() => { panelRef.current?.scrollTo?.({ top: 0 }); }, [focusedKey]);
  if (!episode) return null;

  const rows = completionRows(historyFor(episode), episode.duration, { household });
  const duration = Number(episode.duration) || 0;
  const resumable = resumeSeconds > 0;
  const description = episode.episodeDescription || episode.summary || '';
  const title = episode.label || episode.title || `Episode ${episode.itemIndex ?? ''}`.trim();
  const meta = [
    episode.itemIndex != null ? `Episode ${episode.itemIndex}` : null,
    duration > 0 ? minutesLabel(duration) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="episode-panel" data-testid="episode-panel" ref={panelRef}>
      <header className="episode-panel__header">
        {showTitle && <span className="episode-panel__show">{showTitle}</span>}
        {headerExtras && <span className="episode-panel__header-extras">{headerExtras}</span>}
      </header>

      <EpisodeStillsRail
        episode={episode}
        seasonImage={normalizeImageUrl(seasonImage) || null}
        episodeImage={normalizeImageUrl(episode.image) || null}
      />

      <h3 className="episode-panel__title">{title}</h3>
      {meta && <div className="episode-panel__meta">{meta}</div>}
      {description && <p className="episode-panel__description">{description}</p>}

      <div className="episode-panel__actions">
        {locked ? (
          onUnlock ? (
            <TouchButton variant="secondary" onClick={() => onUnlock(episode)}>
              <LockGlyph />
              Unlock
            </TouchButton>
          ) : (
            <div className="episode-panel__locked"><LockGlyph /><span>Locked — finish the earlier episodes first</span></div>
          )
        ) : (
          <>
            <TouchButton data-testid="play-episode-button" onClick={() => onPlay(episode, resumable ? 'resume' : 'play')}>
              <PlayIcon />
              {resumable ? `Resume ${clock(resumeSeconds)}` : 'Play'}
              {resumable && duration > 0 && (
                <span className="episode-panel__resume-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (resumeSeconds / duration) * 100)}%` }} />
                </span>
              )}
            </TouchButton>
            {resumable && (
              <TouchButton variant="secondary" onClick={() => onPlay(episode, 'start-over')}>
                <RestartIcon />
                Start over
              </TouchButton>
            )}
          </>
        )}
      </div>

      <section className="episode-history" data-testid="episode-history">
        {rows.length === 0
          ? <p className="episode-history__empty">Nobody has done this one yet</p>
          : (
            <ul>
              {rows.map((row) => <HistoryRow key={row.sessionId} row={row} now={now} />)}
            </ul>
          )}
      </section>
    </div>
  );
}
