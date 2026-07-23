/**
 * A material's unit browser (spec §2b/§5/§6), laid out like the household's
 * other show browsers (FitnessShow, Piano Videos): poster + context on the
 * left third, a thumbnail unit grid on the right two-thirds. Fetches units
 * for `userId` on mount (and whenever the material or user changes); no
 * caching — a remount always refetches, which is fine (progress/lock state
 * is per-render-cheap and must reflect the latest write).
 *
 * Purely presentational re: identity: locked units are inert (no-op tap),
 * unlocked/current units call `onPlay(unit)` unconditionally — any
 * claim/guest-notice gating happens one level up (MaterialsSection), which
 * also owns the `notice` string this component only displays (same
 * dumb-child/notice-prop pattern as BankBrowser).
 *
 * Quiz requests: when the current unit is `needsQuiz` (a gated course unit
 * with no bank authored yet), the info panel carries the request affordance —
 * a signed-in child taps once to put the unit on the authoring backlog
 * (POST /quiz-requests); the button then reads as requested. Guests see the
 * explanation but no button (nothing to attribute a request to).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { sizedPlexImage, ART_BOX } from '../plexImage.js';

function formatMinutes(durationMs) {
  if (durationMs == null) return null;
  return `${Math.max(1, Math.round(durationMs / 60000))} min`;
}

// Groups units by `group` (season/parent title) preserving unit order, when
// ANY unit carries a group; otherwise a single ungrouped bucket so the
// render path is uniform (flat list = one group with a null header).
function groupUnits(units) {
  const hasGroups = units.some((u) => u.group);
  if (!hasGroups) return [{ group: null, units }];
  const groups = [];
  const byKey = new Map();
  for (const u of units) {
    const key = u.group ?? '';
    let g = byKey.get(key);
    if (!g) {
      g = { group: u.group ?? null, units: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.units.push(u);
  }
  return groups;
}

const LockGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1zm2 0h6V8a3 3 0 0 0-6 0v2z" fill="currentColor" />
  </svg>
);

const CheckGlyph = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M4.5 12.5 10 18 19.5 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Loading skeleton mirroring the eventual layout (poster left, unit grid or
// chapter list right) so the load reads as "content is coming", not "empty".
// Static blocks (no keyframe animation — the kiosk WebView drops frames).
export function DetailSkeleton({ audio = false }) {
  return (
    <div className="school-material-detail__layout school-skel" aria-hidden="true">
      <aside className="school-material-detail__info">
        <div className="school-skel__poster" />
        <div className="school-skel__line school-skel__line--sm" />
      </aside>
      <div className="school-material-detail__units-panel">
        {audio ? (
          <ul className="school-material-detail__chapters">
            {Array.from({ length: 6 }).map((_, i) => <li key={i}><span className="school-skel__chapter" /></li>)}
          </ul>
        ) : (
          <ul className="school-material-detail__units">
            {Array.from({ length: 16 }).map((_, i) => <li key={i}><span className="school-skel__tile" /></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function MaterialDetail({ material, userId, onBack, onPlay, notice, sectionLabel, initialUnitId = null }) {
  const [units, setUnits] = useState(null);
  const [loadError, setLoadError] = useState(false); // units fetch failed/timed out (vs genuinely empty)
  const [reloadKey, setReloadKey] = useState(0);
  const [requestedUnitIds, setRequestedUnitIds] = useState(() => new Set());
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let alive = true;
    let settled = false;
    setUnits(null);
    setLoadError(false);
    // Hard client-side deadline: the units come from Plex and can stall for a
    // long time (a big show, a Plex hiccup). Never leave the chapter tiles on
    // their loading skeletons indefinitely — after 15s give up and show a retry,
    // regardless of what the backend is doing. Retry re-fetches (and by then the
    // server's own fetch may have completed and cached the result).
    const deadline = setTimeout(() => {
      if (!alive || settled) return;
      settled = true;
      setLoadError(true);
      setUnits([]);
    }, 15000);
    schoolApi.materialUnits(material.id, userId).then(({ ok, data }) => {
      if (!alive || settled) return;
      settled = true;
      clearTimeout(deadline);
      // A failed fetch is NOT an empty material — flag it so we show a retry
      // rather than a bare skeleton (forever) or a misleading "no units".
      if (!ok) { setLoadError(true); setUnits([]); return; }
      setUnits(Array.isArray(data?.units) ? data.units : []);
    });
    schoolApi.quizRequests(material.id).then(({ ok, data }) => {
      if (!alive || !ok || !Array.isArray(data)) return;
      setRequestedUnitIds(new Set(data.map((r) => r.unitId)));
    });
    return () => { alive = false; clearTimeout(deadline); };
  }, [material.id, userId, reloadKey]);

  const groups = units ? groupUnits(units) : [];
  const current = units?.find((u) => u.current) ?? null;
  const doneCount = units?.filter((u) => u.completed).length ?? 0;
  const isAudio = material.medium === 'audio';

  // Deep-link restore: once units resolve, auto-play the unit the URL named,
  // but only if it's unlocked (never auto-launch a locked chapter). One-shot.
  const consumedUnitRef = useRef(null);
  useEffect(() => {
    if (!initialUnitId || !units || consumedUnitRef.current === initialUnitId) return;
    const u = units.find((x) => x.id === initialUnitId);
    if (u && !u.locked) { consumedUnitRef.current = initialUnitId; onPlay(u); }
    else if (u) { consumedUnitRef.current = initialUnitId; } // locked — don't loop, just don't play
  }, [initialUnitId, units, onPlay]);

  const requestQuiz = useCallback(async (unit) => {
    if (!userId || requesting) return;
    setRequesting(true);
    const { ok } = await schoolApi.requestQuiz({
      userId,
      unitId: unit.id,
      materialId: material.id,
      unitTitle: unit.title,
      materialTitle: material.title,
    });
    setRequesting(false);
    if (ok) {
      setRequestedUnitIds((prev) => new Set(prev).add(unit.id));
      schoolLog.materials('quiz-requested', { materialId: material.id, unitId: unit.id, userId });
    }
  }, [userId, requesting, material.id, material.title]);

  // Only offer the quiz request AFTER the current unit has actually been
  // played — requesting a quiz for something you haven't watched/listened to
  // yet is premature. Before that, the unit just plays; the request affordance
  // (and the "waiting for its quiz" lock) appear once it's complete.
  const showRequestPanel = Boolean(current?.needsQuiz && current?.played);
  const currentRequested = current ? requestedUnitIds.has(current.id) : false;

  return (
    <div className="school-material-detail">
      {/* No back row here — the app header's breadcrumb (…› section › this
          material) is the navigation. */}
      {notice && <div className="school-material-detail__notice">{notice}</div>}
      {units === null && <DetailSkeleton audio={isAudio} />}
      {units !== null && (
      <div className="school-material-detail__layout">
        <aside className="school-material-detail__info">
          {material.poster && (
            <img className="school-material-detail__poster" src={sizedPlexImage(material.poster, ...ART_BOX.detailPoster)} alt="" />
          )}
          {/* No title here — the header breadcrumb already names this material.
              Progress: a % bar, then one dot per unit (green done, amber
              partial, hollow not-started). No "N of M done", no per-lock note. */}
          {units.length > 0 && (
            <div className="school-material-detail__progress">
              <div className="school-material-detail__progress-bar">
                <span
                  className="school-material-detail__progress-fill"
                  style={{ width: `${Math.round((doneCount / units.length) * 100)}%` }}
                />
              </div>
              <span className="school-material-detail__progress-pct">
                {Math.round((doneCount / units.length) * 100)}%
              </span>
              <ul className="school-material-detail__dots" aria-hidden="true">
                {units.map((u) => (
                  <li
                    key={u.id}
                    className={`school-material-detail__dot${
                      u.completed ? ' is-done' : (u.percent ?? 0) > 0 ? ' is-partial' : ''
                    }`}
                  />
                ))}
              </ul>
            </div>
          )}
          {material.summary && (
            <p className="school-material-detail__summary">{material.summary}</p>
          )}
          {showRequestPanel && (
            <div className="school-material-detail__quiz-request">
              <p className="school-material-detail__quiz-request-text">
                “{current.title}” doesn&apos;t have a quiz yet — one is needed to move on.
              </p>
              {userId ? (
                <button
                  type="button"
                  className="school-material-detail__quiz-request-button"
                  onClick={() => requestQuiz(current)}
                  disabled={currentRequested || requesting}
                >
                  {currentRequested ? 'Quiz requested ✓' : 'Request a quiz'}
                </button>
              ) : (
                <p className="school-material-detail__quiz-request-hint">Sign in to request one.</p>
              )}
            </div>
          )}
        </aside>
        <div className="school-material-detail__units-panel">
          {units.length === 0 && loadError && (
            <div className="school-material-detail__empty">
              <p>Couldn’t load the chapters — the media server was slow to respond.</p>
              <button
                type="button"
                className="school-material-detail__retry"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {units.length === 0 && !loadError && (
            <div className="school-material-detail__empty">No units yet.</div>
          )}
          {/* Audio chapters have no thumbnails, so a video-style poster grid
              would be a wall of index tiles. They render as a two-column list
              that fills the vertical space (few chapters stretch to fill).
              Locked chapters are inert and wear their lock reason. */}
          {units !== null && units.length > 0 && isAudio && (
            <ul className="school-material-detail__chapters">
              {units.map((u) => {
                const minutes = formatMinutes(u.durationMs);
                const cls = [
                  'school-material-detail__chapter',
                  u.current ? 'is-current' : '',
                  u.locked ? 'is-locked' : '',
                  u.completed ? 'is-done' : '',
                ].filter(Boolean).join(' ');
                return (
                  <li key={u.id}>
                    <button type="button" className={cls} disabled={u.locked} onClick={() => { if (!u.locked) onPlay(u); }}>
                      <span className="school-material-detail__chapter-index">{u.index}</span>
                      <span className="school-material-detail__chapter-body">
                        <span className="school-material-detail__chapter-title">{u.title}</span>
                        {u.locked && u.lockReason && (
                          <span className="school-material-detail__chapter-lockreason">{u.lockReason}</span>
                        )}
                      </span>
                      <span className="school-material-detail__chapter-status">
                        {u.locked ? <LockGlyph /> : u.completed ? <CheckGlyph /> : (minutes || null)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {units !== null && units.length > 0 && !isAudio && groups.map((g, gi) => (
            <div key={g.group ?? `_flat_${gi}`} className="school-material-detail__group">
              {/* No season/group heading — it duplicates what the header
                  breadcrumb already conveys and just adds noise. */}
              <ul className="school-material-detail__units">
                {g.units.map((u) => {
                  const minutes = formatMinutes(u.durationMs);
                  const classes = [
                    'school-material-detail__unit',
                    u.current ? 'school-material-detail__unit--current' : '',
                    u.locked ? 'school-material-detail__unit--locked' : '',
                    u.completed ? 'school-material-detail__unit--done' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        className={classes}
                        disabled={u.locked}
                        onClick={() => { if (!u.locked) onPlay(u); }}
                      >
                        <span className="school-material-detail__thumb">
                          {u.thumb
                            ? <img src={sizedPlexImage(u.thumb, ...ART_BOX.unitThumb)} alt="" loading="lazy" decoding="async" />
                            : <span className="school-material-detail__thumb-fallback">{u.index}</span>}
                          {u.locked && (
                            <span className="school-material-detail__thumb-lock"><LockGlyph /></span>
                          )}
                          {u.completed && (
                            <span className="school-material-detail__thumb-done"><CheckGlyph /></span>
                          )}
                          {minutes && !u.locked && (
                            <span className="school-material-detail__thumb-duration">{minutes}</span>
                          )}
                          {u.percent != null && u.percent > 0 && !u.completed && (
                            <span className="school-material-detail__thumb-progress">
                              <span style={{ width: `${Math.min(100, u.percent)}%` }} />
                            </span>
                          )}
                        </span>
                        <span className="school-material-detail__unit-title">
                          <span className="school-material-detail__unit-index">{u.index}</span>
                          {u.title}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
