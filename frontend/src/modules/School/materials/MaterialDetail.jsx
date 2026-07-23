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

export default function MaterialDetail({ material, userId, onBack, onPlay, notice, sectionLabel, initialUnitId = null }) {
  const [units, setUnits] = useState(null);
  const [requestedUnitIds, setRequestedUnitIds] = useState(() => new Set());
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let alive = true;
    setUnits(null);
    schoolApi.materialUnits(material.id, userId).then(({ ok, data }) => {
      if (!alive) return;
      setUnits(ok && Array.isArray(data?.units) ? data.units : []);
    });
    schoolApi.quizRequests(material.id).then(({ ok, data }) => {
      if (!alive || !ok || !Array.isArray(data)) return;
      setRequestedUnitIds(new Set(data.map((r) => r.unitId)));
    });
    return () => { alive = false; };
  }, [material.id, userId]);

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
      <div className="school-material-detail__layout">
        <aside className="school-material-detail__info">
          {material.poster && (
            <img className="school-material-detail__poster" src={material.poster} alt="" />
          )}
          <h2 className="school-material-detail__title">{material.title}</h2>
          {units !== null && units.length > 0 && (
            <p className="school-material-detail__progress-line">
              {doneCount} of {units.length} done
            </p>
          )}
          {/* One blocker line, not one per locked card: every locked unit
              carries the same reason (the current unit's obligation). */}
          {units?.find((u) => u.locked)?.lockReason && (
            <p className="school-material-detail__lock-note">
              {units.find((u) => u.locked).lockReason}
            </p>
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
          {units === null && <div className="school-material-detail__loading">Loading…</div>}
          {units !== null && units.length === 0 && (
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
              {g.group && <h3 className="school-material-detail__group-title">{g.group}</h3>}
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
                            ? <img src={u.thumb} alt="" loading="lazy" />
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
    </div>
  );
}
