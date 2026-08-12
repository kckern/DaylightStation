import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI, DaylightMediaPath } from '@/lib/api.mjs';
import { humanizeSlug } from './WorkoutRunner.jsx';
import './ExerciseDetail.scss';

/**
 * Exercise detail — the sheet that opens over the browser grid.
 *
 * WHY IT FETCHES AND THE GRID DOES NOT
 * ------------------------------------
 * List responses are summaries (`slug`, `name`, `image`, `groups`,
 * `targetMuscles`, `equipment`). Instructions, description, stills and video
 * only exist on `GET /exercises/:slug`, so this is the one place a per-exercise
 * request is worth making: one open, one request, instead of 1,296 up front.
 *
 * THE GIF IS THE NORMAL CASE
 * --------------------------
 * 52 of 1,296 records carry a `hevy_videos` MP4 (surfaced as `video`). The other
 * 1,244 are not broken and are never labelled as such: the animated GIF is the
 * demo, and the video toggle simply does not appear when there is no video. The
 * toggle is opt-in rather than a default because an MP4 is an order of magnitude
 * heavier than the GIF already on screen and the athlete asked for a still page,
 * not a stream.
 *
 * CHIPS PUSH BACK INTO THE FILTER
 * -------------------------------
 * Tapping a muscle / equipment / group chip calls `onFilter(facet, value)`. The
 * browser owns what that means (it replaces the filter set — see its
 * `filterFromDetail`); this component only reports the tap.
 *
 * onPointerDown, not onClick — the FitnessApp.jsx note. Enter/Space kept on all
 * focusable targets, plus Escape to close.
 */

/** Path for one full record. */
export function detailPath(slug) {
  return `api/v1/fitness/exercises/${encodeURIComponent(slug)}`;
}

function activationKey(event) {
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/** A tappable chip that pushes its value back into the browser's filter. */
function FilterChip({ testId, label, onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    onActivate();
  }, [onActivate]);

  return (
    <div
      className="exercise-detail__chip"
      data-testid={testId}
      role="button"
      tabIndex={0}
      onPointerDown={() => onActivate()}
      onKeyDown={onKeyDown}
    >
      {label}
    </div>
  );
}

FilterChip.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onActivate: PropTypes.func.isRequired
};

function TapTarget({ testId, label, variant = 'primary', onActivate }) {
  const onKeyDown = useCallback((e) => {
    if (!activationKey(e)) return;
    e.preventDefault();
    onActivate();
  }, [onActivate]);

  return (
    <div
      className={`exercise-detail__tap exercise-detail__tap--${variant}`}
      data-testid={testId}
      role="button"
      tabIndex={0}
      onPointerDown={() => onActivate()}
      onKeyDown={onKeyDown}
    >
      {label}
    </div>
  );
}

TapTarget.propTypes = {
  testId: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  variant: PropTypes.string,
  onActivate: PropTypes.func.isRequired
};

export default function ExerciseDetail({
  slug,
  inTray = false,
  onClose = null,
  onAdd = null,
  onFilter = null
}) {
  const logger = useMemo(() => getLogger().child({ component: 'exercise-detail' }), []);

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showVideo, setShowVideo] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // One request per slug. `requestRef` drops a response for a slug the user has
  // already navigated away from (chip -> new detail -> old response lands).
  const requestRef = useRef(0);
  useEffect(() => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    const path = detailPath(slug);
    setLoading(true);
    setError(null);
    setRecord(null);
    setShowVideo(false);
    logger.debug('fetch-start', { slug, path });

    DaylightAPI(path)
      .then((res) => {
        if (id !== requestRef.current) {
          logger.debug('fetch-dropped-stale', { slug });
          return;
        }
        const exercise = res?.exercise ?? null;
        setRecord(exercise);
        setLoading(false);
        logger.info('fetch-success', {
          slug,
          instructions: Array.isArray(exercise?.instructions) ? exercise.instructions.length : 0,
          hasVideo: Boolean(exercise?.video),
          stills: Array.isArray(exercise?.stills) ? exercise.stills.length : 0
        });
      })
      .catch((err) => {
        if (id !== requestRef.current) return;
        setLoading(false);
        setError(err?.message ?? String(err));
        logger.error('fetch-failed', { slug, error: err?.message ?? String(err) });
      });
  }, [slug, logger]);

  // Escape closes. The sheet covers the grid, so there is no other way out for a
  // keyboard user besides finding the close target.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const close = useCallback(() => {
    logger.debug('closed', { slug });
    onCloseRef.current?.();
  }, [logger, slug]);

  const pushFilter = useCallback((facet, value) => {
    logger.info('filter-from-detail', { slug, facet, value });
    onFilter?.(facet, value);
  }, [logger, onFilter, slug]);

  const toggleVideo = useCallback(() => {
    setShowVideo((prev) => !prev);
  }, []);

  // Logged outside the updater — React may invoke updaters twice.
  const videoRef = useRef(false);
  videoRef.current = showVideo;
  const onVideoToggle = useCallback(() => {
    logger.info('video-toggle', { slug, to: !videoRef.current });
    toggleVideo();
  }, [logger, slug, toggleVideo]);

  const name = record?.name || humanizeSlug(slug);
  const instructions = Array.isArray(record?.instructions) ? record.instructions : [];
  const muscles = Array.isArray(record?.targetMuscles) ? record.targetMuscles : [];
  const equipment = Array.isArray(record?.equipment) ? record.equipment : [];
  const groups = Array.isArray(record?.groups) ? record.groups : [];
  const stills = Array.isArray(record?.stills) ? record.stills : [];
  const video = typeof record?.video === 'string' && record.video ? record.video : null;

  return (
    <div
      className="exercise-detail"
      data-testid="exercise-detail"
      data-slug={slug}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <header className="exercise-detail__header">
        <h2 className="exercise-detail__name" data-testid="exercise-detail-name">{name}</h2>
        <TapTarget testId="exercise-detail-close" label="Close" variant="ghost" onActivate={close} />
      </header>

      {loading ? (
        <div className="exercise-detail__notice" data-testid="exercise-detail-loading">Loading…</div>
      ) : error ? (
        <div className="exercise-detail__notice" data-testid="exercise-detail-error">
          Could not load this exercise. {error}
        </div>
      ) : !record ? (
        <div className="exercise-detail__notice" data-testid="exercise-detail-missing">
          This exercise is no longer in the library.
        </div>
      ) : (
        <div className="exercise-detail__body">
          <div className="exercise-detail__media">
            {showVideo && video ? (
              <video
                className="exercise-detail__video"
                data-testid="exercise-detail-video"
                src={DaylightMediaPath(video)}
                controls
                loop
                muted
                playsInline
                autoPlay
              />
            ) : record.image ? (
              <img
                className="exercise-detail__gif"
                data-testid="exercise-detail-gif"
                src={DaylightMediaPath(record.image)}
                alt={name}
                decoding="async"
              />
            ) : (
              <div className="exercise-detail__media-fallback" aria-hidden="true">
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}

            {/* Absent for the 1,244 records with no MP4 — that is the normal
                case, so there is no "video unavailable" message to render. */}
            {video && (
              <TapTarget
                testId="exercise-detail-video-toggle"
                label={showVideo ? 'Show animation' : 'Watch real motion'}
                variant="ghost"
                onActivate={onVideoToggle}
              />
            )}

            {stills.length > 0 && (
              <div className="exercise-detail__stills" data-testid="exercise-detail-stills">
                {stills.map((still) => (
                  <img
                    key={still}
                    className="exercise-detail__still"
                    src={DaylightMediaPath(still)}
                    alt=""
                    decoding="async"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="exercise-detail__info">
            <div className="exercise-detail__facets">
              {groups.map((g) => (
                <FilterChip
                  key={`group-${g}`}
                  testId={`exercise-detail-group-${g}`}
                  label={humanizeSlug(g)}
                  onActivate={() => pushFilter('groups', g)}
                />
              ))}
              {muscles.map((m) => (
                <FilterChip
                  key={`muscle-${m}`}
                  testId={`exercise-detail-muscle-${m}`}
                  label={humanizeSlug(m)}
                  onActivate={() => pushFilter('muscles', m)}
                />
              ))}
              {equipment.map((eq) => (
                <FilterChip
                  key={`equipment-${eq}`}
                  testId={`exercise-detail-equipment-${eq}`}
                  label={humanizeSlug(eq)}
                  onActivate={() => pushFilter('equipment', eq)}
                />
              ))}
            </div>

            {record.description && (
              <p className="exercise-detail__description">{record.description}</p>
            )}

            {instructions.length > 0 ? (
              <ol className="exercise-detail__steps" data-testid="exercise-detail-instructions">
                {instructions.map((line, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li className="exercise-detail__step" key={`step-${i}`}>{line}</li>
                ))}
              </ol>
            ) : (
              <p className="exercise-detail__notice" data-testid="exercise-detail-no-instructions">
                No written steps for this one — follow the animation.
              </p>
            )}

            <TapTarget
              testId="exercise-detail-add"
              label={inTray ? 'Remove from workout' : 'Add to workout'}
              variant={inTray ? 'ghost' : 'primary'}
              onActivate={() => onAdd?.(record)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

ExerciseDetail.propTypes = {
  slug: PropTypes.string.isRequired,
  inTray: PropTypes.bool,
  onClose: PropTypes.func,
  /** Receives the FULL record, so the tray carries instructions into build. */
  onAdd: PropTypes.func,
  /** (facet, value) — 'groups' | 'muscles' | 'equipment'. */
  onFilter: PropTypes.func
};
