import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../icons/Icon.jsx';

/** ms → M:SS for a take's length. */
function mmss(ms) {
  const total = Math.round((ms || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Studio recordings view — review, play back, favourite, and curate saved takes.
 * Recording itself happens on the Play tab; this tab is pure management. Takes
 * are presentational props from the Studio container. Favourites sort to the top.
 */
export default function StudioRecordings({
  isPlaying, connected, takes, confirmId, setConfirmId,
  onToggleFavorite, onDelete,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // Current path is .../studio/recordings; the player lives at .../studio/recordings/:id.
  const open = (id) => navigate(`${location.pathname.replace(/\/+$/, '')}/${id}`);
  const sorted = useMemo(() => {
    const list = takes.map((t) => (typeof t === 'string' ? { id: t, title: t } : t));
    // Favourites first; otherwise newest first (created desc, falling back to title).
    return list.sort((a, b) => {
      if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1;
      return String(b.created || b.id || '').localeCompare(String(a.created || a.id || ''));
    });
  }, [takes]);

  const status = isPlaying ? 'Playing' : connected ? 'Ready' : 'Piano not connected';

  return (
    <div className="piano-studio-recordings">
      <div className="piano-studio__head">
        <h3>Recordings</h3>
        <span className="piano-studio__status">{status}</span>
      </div>

      {sorted.length === 0 && (
        <p className="piano-mode__placeholder">
          No takes yet. Hit Record on the Play tab to capture one.
        </p>
      )}

      <ul className="piano-studio__takes">
        {sorted.map((t) => (
          <li key={t.id} className={t.favorite ? 'is-favorite' : ''}>
            <button
              type="button"
              className={`piano-studio__fav${t.favorite ? ' is-on' : ''}`}
              onClick={() => onToggleFavorite(t.id, !t.favorite)}
              aria-label={t.favorite ? 'Unfavourite' : 'Favourite'}
              aria-pressed={!!t.favorite}
            >
              <span aria-hidden="true">{t.favorite ? '★' : '☆'}</span>
            </button>

            <button type="button" className="piano-studio__open" onClick={() => open(t.id)}>
              <Icon name="play" />
              <span className="piano-studio__take-title">{t.title || t.id}</span>
              {t.durationMs ? <span className="piano-studio__take-dur">{mmss(t.durationMs)}</span> : null}
            </button>

            {confirmId === t.id ? (
              <span className="piano-studio__confirm">
                Delete?
                <button type="button" onClick={() => { setConfirmId(null); onDelete(t.id); }} aria-label="Confirm delete"><Icon name="trash" /></button>
                <button type="button" onClick={() => setConfirmId(null)} aria-label="Cancel delete"><Icon name="close" /></button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmId(t.id)} aria-label="Delete take"><Icon name="trash" /></button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
