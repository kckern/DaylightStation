import React from 'react';
import { normalizeImageUrl } from '@/lib/api.mjs';
import { TouchButton } from '@/lib/ui/TouchButton.jsx';
import { gridBadge, creditedSessions, riderSummary, seasonCoverage, mosaicThumb } from '../lib/episodeHistory.js';
import { RiderAvatar } from './EpisodeHistory.jsx';

// The show screen's left column: always describes the focused episode.
// Top to bottom — where the household is in the season (mosaic + coverage),
// the episode itself (hero, title, Resume / Start over), then who has done it.
// Read at bike distance: nothing under 16px, rider names at 18px+.

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

const imageOf = (ep) => normalizeImageUrl(ep?.image) || null;

// A short season fits one row; longer ones wrap 5 or 6 wide.
const mosaicColumns = (n) => (n <= 6 ? n : n <= 10 ? 5 : 6);

const MosaicTile = ({ episode, focused, done, inProgress, onFocus }) => (
  <div
    role="button"
    tabIndex={-1}
    aria-label={episode.label || episode.title}
    className={[
      'episode-mosaic__tile',
      focused && 'is-focused',
      done && 'is-done',
      inProgress && 'is-in-progress',
    ].filter(Boolean).join(' ')}
    onClick={() => onFocus(episode)}
  >
    {imageOf(episode)
      ? <img src={mosaicThumb(imageOf(episode), 160, 90)} alt="" loading="lazy" />
      : <span className="episode-mosaic__number">{episode.itemIndex ?? ''}</span>}
  </div>
);

const RiderRow = ({ row, formatDate }) => {
  const facts = row.done
    ? [
      `${row.count}×`,
      row.lastStartTime != null ? `last ${formatDate(row.lastStartTime)}` : null,
      Number.isFinite(row.lastMinutes) ? `${Math.round(row.lastMinutes)} min` : null,
      Number.isFinite(row.lastRings) && row.lastRings > 0 ? `${row.lastRings} rings` : null,
    ].filter(Boolean)
    : ['Not yet'];
  return (
    <li className={['episode-rider-row', row.done ? 'is-done' : 'is-not-yet', row.active && 'is-active'].filter(Boolean).join(' ')}>
      <RiderAvatar rider={row} className="episode-rider-row__avatar" />
      <span className="episode-rider-row__name">{row.displayName}</span>
      <span className="episode-rider-row__facts">{facts.join(' · ')}</span>
    </li>
  );
};

export default function EpisodePanel({
  episode,
  showTitle,
  seasonName,
  seasonEpisodes = [],
  historyFor,
  household = [],
  activeIds = [],
  resumeSeconds = 0,
  formatDate,
  onFocus,
  onPlay,
  locked = false,
  onUnlock = null,
  headerExtras = null,
}) {
  if (!episode) return null;
  const focusedKey = episode.plex || episode.id;
  const sessions = historyFor(episode);
  const riders = riderSummary(sessions, episode.duration, { household, activeIds });
  const timesDone = creditedSessions(sessions, episode.duration).length;
  const coverage = seasonEpisodes.length > 1 ? seasonCoverage(seasonEpisodes, historyFor, household) : [];
  const duration = Number(episode.duration) || 0;
  const resumable = resumeSeconds > 0;
  const hero = imageOf(episode);
  const description = episode.episodeDescription || episode.summary || '';
  const title = episode.label || episode.title || `Episode ${episode.itemIndex ?? ''}`.trim();

  return (
    <div className="episode-panel" data-testid="episode-panel">
      <header className="episode-panel__header">
        <span className="episode-panel__show">{showTitle}</span>
        {seasonName && <span className="episode-panel__season">{seasonName}</span>}
        {headerExtras && <span className="episode-panel__header-extras">{headerExtras}</span>}
      </header>

      {seasonEpisodes.length > 1 && (
        <div className="episode-mosaic" data-testid="episode-mosaic" style={{ '--mosaic-cols': mosaicColumns(seasonEpisodes.length) }}>
          {seasonEpisodes.map((ep) => (
            <MosaicTile
              key={ep.plex || ep.id}
              episode={ep}
              focused={(ep.plex || ep.id) === focusedKey}
              done={Boolean(gridBadge(historyFor(ep), ep.duration)) || ep.isWatched === true}
              inProgress={!ep.isWatched && Number(ep.watchProgress) > 0}
              onFocus={onFocus}
            />
          ))}
        </div>
      )}

      {coverage.length > 0 && (
        <div className="season-coverage" data-testid="season-coverage">
          {coverage.map((c) => (
            <span key={c.id} className="season-coverage__chip">
              <RiderAvatar rider={c} className="season-coverage__avatar" />
              <span className="season-coverage__name">{c.displayName}</span>
              <span className="season-coverage__count">{c.done}/{c.total}</span>
            </span>
          ))}
        </div>
      )}

      <div className="episode-panel__hero">
        {hero && <img src={mosaicThumb(hero, 640, 360)} alt="" />}
        <div className="episode-panel__hero-tags">
          {episode.itemIndex != null && <span className="episode-panel__pill">E{episode.itemIndex}</span>}
          {duration > 0 && <span className="episode-panel__pill">{clock(duration)}</span>}
        </div>
        {resumable && duration > 0 && (
          <div className="episode-panel__resume-bar">
            <div style={{ width: `${Math.min(100, (resumeSeconds / duration) * 100)}%` }} />
          </div>
        )}
      </div>

      <h3 className="episode-panel__title">{title}</h3>

      <div className="episode-panel__actions">
        {locked ? (
          onUnlock ? (
            <TouchButton variant="secondary" onClick={() => onUnlock(episode)}>
              <LockGlyph />
              Unlock
            </TouchButton>
          ) : (
            <span className="episode-panel__locked"><LockGlyph />Locked — finish the earlier episodes first</span>
          )
        ) : (
          <>
            <TouchButton data-testid="play-episode-button" onClick={() => onPlay(episode, resumable ? 'resume' : 'play')}>
              <PlayIcon />
              {resumable ? `Resume ${clock(resumeSeconds)}` : 'Play'}
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

      {riders.length > 0 && (
        <section className="episode-riders" data-testid="episode-riders">
          <div className="episode-riders__heading">
            <span>Who&apos;s done it</span>
            {timesDone > 0 && <span className="episode-riders__total">{timesDone} {timesDone === 1 ? 'time' : 'times'}</span>}
          </div>
          <ul>
            {riders.map((row) => <RiderRow key={row.id} row={row} formatDate={formatDate} />)}
          </ul>
        </section>
      )}

      {description && <p className="episode-panel__description">{description}</p>}
    </div>
  );
}
