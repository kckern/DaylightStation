/**
 * FilterRail — the preview surround's sidebar (`content-filter-rail`).
 *
 * Header: what this is, how far to trust it (the certification, in words) and
 * what the filter does to this film. Two tabs. Review: the moment just filtered
 * (replay it), the next five coming up (a scene's pieces are one row; choose one
 * to jump there and select it, then peek at it unfiltered), and the WorkshopPanel
 * for the selected one. Settings: the SettingsPanel.
 *
 * The selection lives in the preview store, so a mark clicked on the timeline
 * and a row chosen here are the same selection. Mouse-only: plain buttons.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useFilterPreview, previewStore, PREVIEW_LEAD_SEC } from './previewStore.js';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';
import { baseId } from '../useContentFilter.js';
import WorkshopPanel from './WorkshopPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import {
  effectWord, rowLabel, kindOf, clock, awayText, certificationText, effectSentence,
} from './effectKinds.js';
import './contentFilterTheme.scss';
import './FilterRail.scss';

export { effectWord, rowLabel };

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

/** The timeline's own mark shape, in its kind colour — the row's key. */
const Glyph = ({ effect }) => <i className={`filter-rail__glyph is-${kindOf(effect)}`} aria-hidden="true" />;
/** The effect in a word ("muted", "hidden"). */
const Effect = ({ effect }) => <span className="filter-rail__effect">{effectWord(effect)}</span>;

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export default function FilterRail({ position = 0 }) {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'filter-rail' }), []);
  const [tab, setTab] = useState('review'); // 'review' | 'settings'
  const items = useMemo(() => upcomingItems(snap.cues, snap.scenes, position), [snap.cues, snap.scenes, position]);
  const last = snap.lastFired;
  const selectedId = snap.selected?.id != null ? String(snap.selected.id) : null;
  const level = snap.certification?.level || null;
  const cert = certificationText(level);
  const summary = String(snap.summary || '').split(' · ').filter(Boolean);
  const selectedItem = items.find((it) => it.id === selectedId) || null;

  useEffect(() => { logger.debug('filter-rail.mounted', {}); return () => logger.debug('filter-rail.unmounted', {}); }, [logger]);

  const select = (item) => {
    previewStore.publish({ selected: item.kind === 'scene' ? { id: item.id, kind: 'scene', in: item.in } : item.cue });
    previewStore.jumpToCue(item.cue);
    logger.info('filter-rail.jump', { id: item.id, kind: item.kind, in: item.in });
  };
  const switchTab = (v) => {
    if (v === tab) return;
    setTab(v);
    logger.info('filter-rail.tab', { tab: v });
  };

  return (
    <aside className="filter-rail">
      <header className="filter-rail__head">
        <div className="filter-rail__titlebar">
          <div className="filter-rail__titles">
            <h3 className="filter-rail__title">Filter preview</h3>
            {snap.title ? <div className="filter-rail__film">{snap.title}</div> : null}
          </div>
          <button
            type="button"
            className="filter-rail__close"
            aria-label="Close preview"
            data-cf-hint="Close the preview. The film keeps playing, still filtered."
            data-cf-hint-align="end"
            data-cf-hint-side="below"
            onClick={() => previewStore.close()}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={`filter-rail__cert is-${cert.tone}`}>
          <span className="filter-rail__level">{level && level !== 'none' ? level : 'not checked'}</span>
          <span className="filter-rail__cert-line">{cert.line}</span>
        </div>

        {summary.length ? (
          <ul className="filter-rail__summary" aria-label="What the filter does to this film">
            {summary.map((s) => <li key={s}>{s}</li>)}
          </ul>
        ) : null}
      </header>

      <div className="filter-rail__tabs" role="tablist" aria-label="Rail view">
        {[['review', 'Review'], ['settings', 'Settings']].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} className={`filter-rail__tab${tab === v ? ' is-selected' : ''}`} onClick={() => switchTab(v)}>{label}</button>
        ))}
      </div>

      {tab === 'settings' ? (
        <div className="filter-rail__body is-settings">
          <p className="filter-rail__note">Choose what the filter does. Changes apply from the next moment it reaches.</p>
          <SettingsPanel />
        </div>
      ) : (
        <div className="filter-rail__body">
          <section className="filter-rail__section">
            <h4>Last</h4>
            {last ? (
              <div className="filter-rail__last">
                <div className="filter-rail__line">
                  <Glyph effect={last.effect} />
                  <span className="filter-rail__label">{rowLabel(last)}</span>
                  <Effect effect={last.effect} />
                  <span className="filter-rail__time">{clock(last.in)}</span>
                </div>
                <button
                  type="button"
                  className="filter-rail__btn"
                  aria-label="Replay last"
                  data-cf-hint={`Play it again from ${PREVIEW_LEAD_SEC} s before, filtered.`}
                  data-cf-hint-align="start"
                  onClick={() => previewStore.replayLast()}
                >
                  Replay
                </button>
              </div>
            ) : <p className="filter-rail__empty">Nothing filtered yet. Each moment shows up here as the film reaches it.</p>}
          </section>

          <section className="filter-rail__section">
            <h4>Next</h4>
            {items.length === 0 ? <p className="filter-rail__empty">Nothing else is filtered from here to the end.</p> : (
              <>
                <ul className="filter-rail__list">
                  {items.map((it) => (
                    <li key={`${it.kind}:${it.id}`}>
                      <button
                        type="button"
                        data-testid="filter-rail-next"
                        className={`filter-rail__row is-${kindOf(it.effect)}${selectedId === it.id ? ' is-selected' : ''}`}
                        aria-pressed={selectedId === it.id}
                        onClick={() => select(it)}
                      >
                        <Glyph effect={it.effect} />
                        <span className="filter-rail__label">{rowLabel(it)}</span>
                        <Effect effect={it.effect} />
                        <span className="filter-rail__away">{awayText(it.in - position)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {selectedId == null && items.length ? (
              <p className="filter-rail__note">Choose one to jump there and decide what happens to it.</p>
            ) : null}
            {selectedId != null ? (
              <div className="filter-rail__peek">
                <button
                  type="button"
                  className="filter-rail__btn"
                  aria-label="Peek unfiltered"
                  onClick={() => { previewStore.peek(baseId(selectedId)); logger.info('filter-rail.peek', { id: baseId(selectedId) }); }}
                >
                  Peek unfiltered
                </button>
                <span className="filter-rail__note">
                  {selectedItem ? `${effectSentence(selectedItem.effect)} ` : ''}{`Peek plays it once without the filter, from ${PREVIEW_LEAD_SEC} s before, then the filter is back on.`}
                </span>
              </div>
            ) : null}
          </section>

          <WorkshopPanel />
        </div>
      )}
    </aside>
  );
}
