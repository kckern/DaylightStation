/**
 * A material's unit list (spec §2b/§5/§6). Fetches units for `userId` on
 * mount (and whenever the material or user changes); no caching -- a
 * remount always refetches, which is fine (progress/lock state is
 * per-render-cheap and must reflect the latest write).
 *
 * Purely presentational re: identity: locked units are inert (no-op tap),
 * unlocked/current units call `onPlay(unit)` unconditionally -- any
 * claim/guest-notice gating happens one level up (MaterialsSection), which
 * also owns the `notice` string this component only displays (same
 * dumb-child/notice-prop pattern as BankBrowser).
 */
import { useEffect, useState } from 'react';
import { schoolApi } from '../schoolApi.js';

function formatMinutes(durationMs) {
  if (durationMs == null) return null;
  return `~${Math.max(1, Math.round(durationMs / 60000))} min`;
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

export default function MaterialDetail({ material, userId, onBack, onPlay, notice, sectionLabel }) {
  const [units, setUnits] = useState(null);

  useEffect(() => {
    let alive = true;
    setUnits(null);
    schoolApi.materialUnits(material.id, userId).then(({ ok, data }) => {
      if (!alive) return;
      setUnits(ok && Array.isArray(data?.units) ? data.units : []);
    });
    return () => { alive = false; };
  }, [material.id, userId]);

  const groups = units ? groupUnits(units) : [];

  return (
    <div className="school-material-detail">
      <button type="button" className="school-material-detail__back" onClick={onBack}>
        ‹ All {sectionLabel}
      </button>
      <h2 className="school-material-detail__title">{material.title}</h2>
      {notice && <div className="school-material-detail__notice">{notice}</div>}
      {units === null && <div className="school-material-detail__loading">Loading…</div>}
      {units !== null && units.length === 0 && (
        <div className="school-material-detail__empty">No units yet.</div>
      )}
      {units !== null && units.length > 0 && groups.map((g, gi) => (
        <div key={g.group ?? `_flat_${gi}`} className="school-material-detail__group">
          {g.group && <h3 className="school-material-detail__group-title">{g.group}</h3>}
          <ul className="school-material-detail__units">
            {g.units.map((u) => {
              const minutes = formatMinutes(u.durationMs);
              const classes = [
                'school-material-detail__unit',
                u.current ? 'school-material-detail__unit--current' : '',
                u.locked ? 'school-material-detail__unit--locked' : '',
              ].filter(Boolean).join(' ');
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className={classes}
                    disabled={u.locked}
                    onClick={() => { if (!u.locked) onPlay(u); }}
                  >
                    <span className="school-material-detail__unit-index">{u.index}</span>
                    <span className="school-material-detail__unit-body">
                      <span className="school-material-detail__unit-title">{u.title}</span>
                      {u.locked && u.lockReason && (
                        <span className="school-material-detail__unit-lockreason">{u.lockReason}</span>
                      )}
                    </span>
                    {minutes && <span className="school-material-detail__unit-duration">{minutes}</span>}
                    {u.completed && <span className="school-material-detail__unit-done">Done</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
