/**
 * FilterRail — the preview surround's sidebar (`content-filter-rail`).
 * Header (certification + summary + close), the last filtered moment with replay,
 * and the next five upcoming moments (a scene's pieces collapse to one row) with
 * jump and peek-unfiltered on the selected row. Mouse-only: plain buttons.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useFilterPreview, previewStore } from './previewStore.js';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';
import WorkshopPanel from './WorkshopPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import './FilterRail.scss';

const EFFECT_WORD = {
  mute: 'muted', bleep: 'bleeped',
  blur: 'blurred', 'full-blur': 'blurred', pixelate: 'blurred', 'censor-bar': 'blurred',
  blackout: 'blacked out', skip: 'skipped', 'skip-card': 'skipped', 'title-card': 'card',
};
export const effectWord = (e) => EFFECT_WORD[e] || e || '';
/** A row's label; scene pieces carry none, so fall back to "Scene" + effect word. */
export const rowLabel = (item) => item?.label || `Scene ${effectWord(item?.effect)}`.trim();

const NEXT_COUNT = 5;

/** Upcoming items after `position`: one per scene (earliest piece), then lone cues. */
export function upcomingItems(cues, scenes, position, count = NEXT_COUNT) {
  const sceneById = new Map((scenes || []).map((s) => [String(s.id), s]));
  const seen = new Set();
  const items = [];
  const sorted = [...(cues || [])].filter((c) => Number.isFinite(c.in)).sort((a, b) => a.in - b.in);
  for (const cue of sorted) {
    if (cue.in <= position) continue;
    if (cue.scene != null) {
      const sid = String(cue.scene);
      if (seen.has(sid)) continue;
      seen.add(sid);
      const scene = sceneById.get(sid);
      items.push({ id: sid, kind: 'scene', cue, in: cue.in, effect: cue.effect, label: scene?.label || cue.label || '' });
    } else {
      items.push({ id: String(cue.id), kind: 'cue', cue, in: cue.in, effect: cue.effect, label: cue.label || String(cue.id) });
    }
    if (items.length >= count) break;
  }
  return items;
}

export default function FilterRail({ position = 0 }) {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'filter-rail' }), []);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('review'); // 'review' | 'settings'
  const items = useMemo(() => upcomingItems(snap.cues, snap.scenes, position), [snap.cues, snap.scenes, position]);
  const last = snap.lastFired;

  useEffect(() => { logger.debug('filter-rail.mounted', {}); return () => logger.debug('filter-rail.unmounted', {}); }, [logger]);

  const select = (item) => {
    setSelectedId(item.id);
    previewStore.publish({ selected: item.kind === 'scene' ? { id: item.id, kind: 'scene', in: item.in } : item.cue });
    previewStore.jumpToCue(item.cue);
    logger.info('filter-rail.jump', { id: item.id, kind: item.kind, in: item.in });
  };

  return (
    <aside className="filter-rail">
      <header className="filter-rail__head">
        <div className="filter-rail__cert">
          <span className="filter-rail__level">{snap.certification?.level ?? ''}</span>
          <button type="button" className="filter-rail__btn" aria-label="Close preview" onClick={() => previewStore.close()}>Close</button>
        </div>
        {snap.summary ? <div className="filter-rail__summary">{snap.summary}</div> : null}
      </header>

      <div className="filter-rail__buttons" role="tablist" aria-label="Rail view">
        {[['review', 'Review'], ['settings', 'Settings']].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} className={`filter-rail__btn${tab === v ? ' is-selected' : ''}`} onClick={() => setTab(v)}>{label}</button>
        ))}
      </div>

      {tab === 'settings' ? <SettingsPanel /> : (
      <>
      <section className="filter-rail__section">
        <h4>Last</h4>
        {last ? (
          <>
            <div className="filter-rail__last">
              <span className="filter-rail__label">{rowLabel(last)}</span>
              <span className="filter-rail__effect">{effectWord(last.effect)}</span>
            </div>
            <button type="button" className="filter-rail__btn" aria-label="Replay last" onClick={() => previewStore.replayLast()}>Replay last</button>
          </>
        ) : <div className="filter-rail__empty">Nothing filtered yet</div>}
      </section>

      <section className="filter-rail__section">
        <h4>Next</h4>
        {items.length === 0 ? <div className="filter-rail__empty">Nothing ahead</div> : (
          <ul className="filter-rail__list">
            {items.map((it) => (
              <li key={`${it.kind}:${it.id}`}>
                <button
                  type="button"
                  data-testid="filter-rail-next"
                  className={`filter-rail__row${selectedId === it.id ? ' is-selected' : ''}`}
                  onClick={() => select(it)}
                >
                  <span className="filter-rail__label">{rowLabel(it)}</span>
                  <span className="filter-rail__effect">{effectWord(it.effect)}</span>
                  <span className="filter-rail__away">{Math.max(0, Math.round(it.in - position))}s</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedId != null ? (
          <button type="button" className="filter-rail__btn" aria-label="Peek unfiltered" onClick={() => previewStore.peek(selectedId)}>Peek unfiltered</button>
        ) : null}
      </section>

      <WorkshopPanel />
      </>
      )}
    </aside>
  );
}
