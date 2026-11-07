/**
 * WorkshopPanel — the grown-up's rulings for the selected scene or cue, inside the
 * preview rail. A scene: Tags only / Blackout / Skip / Profile plus its title card
 * (draft with AI, edit, approve, withdraw). A cue: Off / Mute / Bleep / Blur / Skip.
 * Every successful write refreshes the player's filter; a failure shows its text and
 * leaves the player alone. Mouse-only: plain buttons.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useFilterPreview, previewStore } from './previewStore.js';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';

const SCENE_EFFECTS = [
  { label: 'Tags only', value: 'off', current: (r) => r.effect === 'off' },
  { label: 'Blackout', value: 'blackout', current: (r) => r.effect === 'blackout' },
  { label: 'Skip', value: 'skip', current: (r) => r.effect === 'skip' },
  { label: 'Profile', value: 'profile', current: (r) => !r.effect },
];
const CUE_EFFECTS = [
  { label: 'Off', value: 'off' }, { label: 'Mute', value: 'mute' }, { label: 'Bleep', value: 'bleep' },
  { label: 'Blur', value: 'blur' }, { label: 'Skip', value: 'skip' },
];

const base = (rk) => `/api/v1/content-filter/${encodeURIComponent(rk)}`;
const errText = (e) => e?.message || 'request failed';

export default function WorkshopPanel() {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'workshop-panel' }), []);
  const sel = snap.selected;
  const rk = snap.ratingKey;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null); // { id, text } typed or drafted, not yet approved
  const [editing, setEditing] = useState(false);

  useEffect(() => { setError(''); setDraft(null); setEditing(false); }, [sel?.id, sel?.kind]);

  if (!sel || rk == null) return null;
  const isScene = sel.kind === 'scene';

  const write = async (fn, event, data) => {
    setBusy(true); setError('');
    try {
      const out = await fn();
      await previewStore.refresh();
      if (event) logger.info(event, data);
      return out;
    } catch (e) {
      setError(errText(e));
      logger.warn('content-filter.workshop.failed', { ...data, error: errText(e) });
      return undefined;
    } finally { setBusy(false); }
  };

  if (!isScene) {
    const ruling = snap.override?.cueOverrides?.[sel.id] || {};
    const cur = ruling.disabled ? 'off' : ruling.effect;
    const rule = (effect) => write(
      () => DaylightAPI(`${base(rk)}/cues/${encodeURIComponent(sel.id)}`, { effect }, 'PUT'),
      'content-filter.cue.ruled', { ratingKey: rk, cue: sel.id, effect },
    );
    return (
      <section className="filter-rail__section" data-testid="workshop-panel">
        <h4>Rule this cue</h4>
        <div className="filter-rail__buttons">
          {CUE_EFFECTS.map((o) => (
            <button key={o.value} type="button" className={`filter-rail__btn${cur === o.value ? ' is-selected' : ''}`} disabled={busy} onClick={() => rule(o.value)}>{o.label}</button>
          ))}
          <button type="button" className="filter-rail__btn" disabled={busy || !cur} onClick={() => rule('profile')}>Profile</button>
        </div>
        {error ? <div className="filter-rail__error" role="alert">{error}</div> : null}
      </section>
    );
  }

  const ruling = snap.override?.sceneOverrides?.[sel.id] || {};
  const scene = (snap.scenes || []).find((s) => String(s.id) === String(sel.id));
  const approved = ruling.card?.text || '';
  const drafted = scene?.card?.text || '';
  const text = draft?.id === sel.id ? draft.text : (approved || drafted);
  const url = `${base(rk)}/scenes/${encodeURIComponent(sel.id)}`;

  const rule = (effect) => write(
    () => DaylightAPI(url, { effect }, 'PUT'),
    'content-filter.scene.ruled', { ratingKey: rk, scene: sel.id, effect },
  );
  const draftCard = async () => {
    setBusy(true); setError('');
    try {
      const out = await DaylightAPI(`${url}/card`, {}, 'POST');
      setDraft({ id: sel.id, text: out?.card?.text || '' });
      setEditing(false);
      logger.info('content-filter.card.drafted', { ratingKey: rk, scene: sel.id });
      await previewStore.refresh();
    } catch (e) {
      setError(`Could not draft a card: ${errText(e)}`);
      logger.warn('content-filter.workshop.failed', { ratingKey: rk, scene: sel.id, error: errText(e) });
    } finally { setBusy(false); }
  };
  const approve = async () => {
    const ok = await write(
      () => DaylightAPI(url, { card: { approve: true, text } }, 'PUT'),
      'content-filter.card.approved', { ratingKey: rk, scene: sel.id },
    );
    if (ok !== undefined) { setDraft(null); setEditing(false); }
  };
  const withdraw = async () => {
    const ok = await write(() => DaylightAPI(url, { card: null }, 'PUT'), 'content-filter.card.withdrawn', { ratingKey: rk, scene: sel.id });
    if (ok !== undefined) setDraft(null);
  };

  return (
    <section className="filter-rail__section" data-testid="workshop-panel">
      <h4>Rule this scene</h4>
      <div className="filter-rail__buttons">
        {SCENE_EFFECTS.map((o) => (
          <button key={o.value} type="button" className={`filter-rail__btn${o.current(ruling) ? ' is-selected' : ''}`} disabled={busy} onClick={() => rule(o.value)}>{o.label}</button>
        ))}
      </div>
      <h4>Title card</h4>
      {editing ? (
        <textarea
          className="filter-rail__card-input"
          aria-label="Card text"
          value={text}
          maxLength={90}
          onChange={(e) => setDraft({ id: sel.id, text: e.target.value })}
        />
      ) : (
        <div className="filter-rail__card" data-testid="workshop-card">{text || 'No card yet'}</div>
      )}
      {approved && text === approved ? <div className="filter-rail__empty">Approved</div> : null}
      <div className="filter-rail__buttons">
        <button type="button" className="filter-rail__btn" disabled={busy} onClick={draftCard}>{text ? 'Regenerate' : 'Draft with AI'}</button>
        {text ? <button type="button" className="filter-rail__btn" disabled={busy} onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit'}</button> : null}
        {text && text !== approved ? <button type="button" className="filter-rail__btn" disabled={busy} onClick={approve}>Approve</button> : null}
        {approved ? <button type="button" className="filter-rail__btn" disabled={busy} onClick={withdraw}>Withdraw</button> : null}
      </div>
      {error ? <div className="filter-rail__error" role="alert">{error}</div> : null}
    </section>
  );
}
