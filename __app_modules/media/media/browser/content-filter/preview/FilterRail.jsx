/**
 * FilterRail — the preview surround's sidebar (`content-filter-rail`).
 *
 * Header: what this is and how far to trust it (the certification, in words).
 * Two tabs. Review answers a parent's questions about the film, one kind at a
 * time: a switch (All / Words / Picture / Scenes, each with its count of
 * moments) and a Find field over the whole film. All: the moment just filtered
 * (Replay) and the next of each kind, so a dense run of muted words never hides
 * the next blur or skip. Words and Picture: the next five of that kind, then the
 * whole film on request. Scenes: every scene or moment that is skipped or
 * hidden, with its levels, its title card's status and one-click Approve, then
 * the flagged scenes the filter lets play, each one choosable so it can be cut.
 * Whatever is selected (here or on the timeline) sits in one block above the
 * lists with its details, Jump there, Peek unfiltered and the WorkshopPanel's
 * rulings. Settings: the SettingsPanel.
 *
 * Moments come from `railItems.js`: a tracked blur's many pieces are one moment,
 * a scene is one moment. The selection lives in the preview store, so a mark
 * clicked on the timeline and a row chosen here are the same selection.
 * Mouse-only: plain buttons, no sliders.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFilterPreview, previewStore, PREVIEW_LEAD_SEC } from './previewStore.js';
import { getChildLogger } from '../../../../../../frontend/src/lib/logging/singleton.js';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { useFilterWrite, errText } from './useFilterWrite.js';
import { baseId } from '../useContentFilter.js';
import WorkshopPanel from './WorkshopPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import {
  effectWord, effectChip, rowLabel, kindOf, clock, awayText, certificationText, effectSentence, categoryText, lengthText,
} from './effectKinds.js';
import {
  GROUPS, buildMoments, groupCounts, upcoming, nextOfEach, matchesFind, sceneRows, cardOf, selectionKey, levelLines,
} from './railItems.js';
import './contentFilterTheme.scss';
import './FilterRail.scss';

export { effectWord, rowLabel };

const NEXT_COUNT = 5;
const FIND_LIMIT = 60;

/** What a group's moments are called, one and many. */
const NOUN = {
  words: ['muted word', 'muted words'],
  picture: ['blurred moment', 'blurred moments'],
  scenes: ['skipped or hidden part', 'skipped or hidden parts'],
};
const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

/** The timeline's own mark shape, in its kind colour: the row's key. */
const Glyph = ({ effect }) => <i className={`filter-rail__glyph is-${effect ? kindOf(effect) : 'shown'}`} aria-hidden="true" />;

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** "9:13 to 9:20, 7 s" */
function spanText(m) {
  const len = lengthText(m.out - m.in);
  return `${clock(m.in)} to ${clock(m.out)}${len ? `, ${len}` : ''}`;
}

/** One moment as a choosable row: glyph, label over a soft line, time at the right. */
function MomentRow({ m, sub, time, selected, past, onSelect, testId = 'filter-rail-row' }) {
  return (
    <li>
      <button
        type="button"
        data-testid={testId}
        data-group={m.group}
        className={`filter-rail__row is-${m.effect ? kindOf(m.effect) : 'shown'}${selected ? ' is-selected' : ''}${past ? ' is-past' : ''}`}
        aria-pressed={selected}
        onClick={() => onSelect(m)}
      >
        <Glyph effect={m.effect} />
        <span className="filter-rail__main">
          <span className="filter-rail__label">{rowLabel(m)}</span>
          {sub ? <span className="filter-rail__sub">{sub}</span> : null}
        </span>
        <span className="filter-rail__away">{time}</span>
      </button>
    </li>
  );
}

export default function FilterRail({ position = 0 }) {
  const snap = useFilterPreview();
  const logger = useMemo(() => getChildLogger({ app: 'content-filter', component: 'filter-rail' }), []);
  const [tab, setTab] = useState('review'); // 'review' | 'settings'
  const [group, setGroup] = useState('all'); // 'all' | 'words' | 'picture' | 'scenes'
  const [find, setFind] = useState('');
  const [showAll, setShowAll] = useState(false);
  const selectedRef = useRef(null);

  const moments = useMemo(() => buildMoments(snap.cues, snap.scenes), [snap.cues, snap.scenes]);
  const counts = useMemo(() => groupCounts(moments), [moments]);
  const scenes = useMemo(() => sceneRows(moments, snap.scenes), [moments, snap.scenes]);
  const selKey = selectionKey(snap.selected);
  const selected = useMemo(() => {
    if (!selKey) return null;
    return moments.find((m) => m.key === selKey) || scenes.shown.find((m) => m.key === selKey) || null;
  }, [selKey, moments, scenes]);

  const last = snap.lastFired;
  const level = snap.certification?.level || null;
  const cert = certificationText(level);

  useEffect(() => { logger.debug('filter-rail.mounted', {}); return () => logger.debug('filter-rail.unmounted', {}); }, [logger]);
  useEffect(() => { setShowAll(false); }, [group]);
  useEffect(() => {
    if (selKey && selectedRef.current?.scrollIntoView) selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selKey]);

  const select = (m) => {
    previewStore.publish({ selected: m.kind === 'scene' ? { id: m.id, kind: 'scene', in: m.in } : m.cue });
    previewStore.jumpToCue({ in: m.in });
    logger.info('filter-rail.jump', { id: m.id, kind: m.kind, group: m.group, in: m.in });
  };
  const switchTab = (v) => {
    if (v === tab) return;
    setTab(v);
    logger.info('filter-rail.tab', { tab: v });
  };
  const switchGroup = (v) => {
    if (v === group) return;
    setGroup(v);
    logger.info('filter-rail.kind', { group: v });
  };

  const rowProps = (m) => ({ m, selected: m.key === selKey, onSelect: select });

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
          <div className="filter-rail__kinds" role="group" aria-label="Show">
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                data-testid="filter-rail-kind"
                data-kind={g.key}
                aria-pressed={group === g.key}
                aria-label={`${g.name}, ${counts[g.key]}`}
                className={`filter-rail__kind is-${g.key}${group === g.key ? ' is-selected' : ''}${counts[g.key] ? '' : ' is-none'}`}
                onClick={() => switchGroup(g.key)}
              >
                <span className="filter-rail__kind-name">{g.name}</span>
                <span className="filter-rail__kind-count">{counts[g.key]}</span>
              </button>
            ))}
          </div>

          <label className="filter-rail__find">
            <span className="filter-rail__visually-hidden">Find a word or moment</span>
            <input
              type="search"
              value={find}
              placeholder={group === 'words' ? 'Find a word' : 'Find a word or moment'}
              onChange={(e) => setFind(e.target.value)}
            />
            {find ? (
              <button type="button" className="filter-rail__find-clear" aria-label="Clear find" onClick={() => setFind('')}><CloseIcon /></button>
            ) : null}
          </label>

          {selected || snap.selected ? (
            <div ref={selectedRef}>
              <SelectedBlock m={selected} sel={snap.selected} logger={logger} />
            </div>
          ) : null}

          {find.trim() ? (
            <FindResults
              moments={[...moments, ...(group === 'scenes' || group === 'all' ? scenes.shown : [])]}
              group={group} query={find} position={position} rowProps={rowProps}
            />
          ) : group === 'all' ? (
            <AllView moments={moments} counts={counts} position={position} last={last} rowProps={rowProps} />
          ) : group === 'scenes' ? (
            <ScenesView scenes={scenes} snap={snap} position={position} rowProps={rowProps} logger={logger} onSettings={() => switchTab('settings')} />
          ) : (
            <KindView
              group={group} moments={moments} count={counts[group]} position={position}
              showAll={showAll} onShowAll={() => setShowAll((v) => !v)} rowProps={rowProps} onSettings={() => switchTab('settings')}
            />
          )}
        </div>
      )}
    </aside>
  );
}

/** All: the moment just filtered, then the next of each kind. */
function AllView({ moments, counts, position, last, rowProps }) {
  const each = nextOfEach(moments, position);
  return (
    <>
      <section className="filter-rail__section">
        <h4>Just filtered</h4>
        {last ? (
          <div className="filter-rail__last">
            <div className="filter-rail__line">
              <Glyph effect={last.effect} />
              <span className="filter-rail__main"><span className="filter-rail__label">{rowLabel(last)}</span><span className="filter-rail__sub">{effectChip(last.effect)}</span></span>
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
        ) : <p className="filter-rail__empty">Nothing yet. Each moment shows up here as the film reaches it.</p>}
      </section>

      <section className="filter-rail__section">
        <h4>Next of each kind</h4>
        <ul className="filter-rail__list" data-testid="filter-rail-next-each">
          {['words', 'picture', 'scenes'].map((g) => {
            const { next, after } = each[g];
            if (!next) {
              return (
                <li key={g} className="filter-rail__none" data-testid="filter-rail-none" data-group={g}>
                  <i className={`filter-rail__glyph is-${g === 'words' ? 'words' : g === 'picture' ? 'picture' : 'skipped'} is-dim`} aria-hidden="true" />
                  <span>{counts[g] ? `No more ${NOUN[g][1]} from here.` : `No ${NOUN[g][1]} in this film.`}</span>
                </li>
              );
            }
            return (
              <MomentRow
                key={g}
                {...rowProps(next)}
                testId="filter-rail-next"
                sub={`${effectChip(next.effect)}${after ? `, ${after} more after it` : ', the last one'}`}
                time={awayText(next.in - position)}
              />
            );
          })}
        </ul>
        <p className="filter-rail__note">Choose one to jump there and see what happens to it.</p>
      </section>
    </>
  );
}

/** Words or Picture: the next five of that kind, then the whole film on request. */
function KindView({ group, moments, count: total, position, showAll, onShowAll, rowProps, onSettings }) {
  const next = upcoming(moments, group, position, NEXT_COUNT);
  const all = moments.filter((m) => m.group === group);
  if (!total) {
    return (
      <section className="filter-rail__section">
        <p className="filter-rail__empty">
          {group === 'words'
            ? 'No words are muted in this film. Profanity, blasphemy and other language are set in Settings.'
            : 'Nothing on screen is blurred in this film. Violence, nudity and sexual content can be set to blur in Settings.'}
        </p>
        <button type="button" className="filter-rail__btn" onClick={onSettings}>Open settings</button>
      </section>
    );
  }
  return (
    <section className="filter-rail__section">
      {showAll ? (
        <>
          <h4>{`All ${count(total, NOUN[group])}, in film order`}</h4>
          <ul className="filter-rail__list" data-testid="filter-rail-all">
            {all.map((m) => (
              <MomentRow key={m.key} {...rowProps(m)} sub={subOf(m)} time={clock(m.in)} past={m.in <= position} />
            ))}
          </ul>
          <button type="button" className="filter-rail__btn is-quiet" onClick={onShowAll}>Show only what is next</button>
        </>
      ) : (
        <>
          <h4>Next</h4>
          {next.length ? (
            <ul className="filter-rail__list">
              {next.map((m) => (
                <MomentRow key={m.key} {...rowProps(m)} testId="filter-rail-next" sub={subOf(m)} time={awayText(m.in - position)} />
              ))}
            </ul>
          ) : <p className="filter-rail__empty">{`No more ${NOUN[group][1]} from here to the end.`}</p>}
          <button type="button" className="filter-rail__btn is-quiet" onClick={onShowAll}>{`Show all ${total} in film order`}</button>
        </>
      )}
    </section>
  );
}

/** A row's soft line: the effect, and how long, or the category for a picture. */
function subOf(m) {
  if (m.group === 'picture') return [effectChip(m.effect), categoryText(m.category)].filter(Boolean).join(', ');
  if (m.group === 'scenes') return `${effectChip(m.effect)}, ${lengthText(m.out - m.in) || 'brief'}`;
  return effectChip(m.effect);
}

/** Find: matches across the whole film, in film order. */
function FindResults({ moments, group, query, position, rowProps }) {
  const hits = moments
    .filter((m) => (group === 'all' || m.group === group) && matchesFind(m, query))
    .sort((a, b) => a.in - b.in);
  return (
    <section className="filter-rail__section">
      <h4>{hits.length ? `Found ${hits.length}` : 'Found nothing'}</h4>
      {hits.length ? (
        <ul className="filter-rail__list" data-testid="filter-rail-found">
          {hits.slice(0, FIND_LIMIT).map((m) => (
            <MomentRow key={m.key} {...rowProps(m)} sub={m.effect ? subOf(m) : 'Shown, its own moments filtered'} time={clock(m.in)} past={m.in <= position} />
          ))}
        </ul>
      ) : (
        <p className="filter-rail__empty">
          {`Nothing ${group === 'all' ? 'the filter changes' : `in ${GROUPS.find((g) => g.key === group).name}`} matches "${query.trim()}". Words are found by their letters, so "hell" finds h*ll.`}
        </p>
      )}
      {hits.length > FIND_LIMIT ? <p className="filter-rail__note">{`Showing the first ${FIND_LIMIT}. Add a word to narrow it.`}</p> : null}
    </section>
  );
}

/** Scenes: everything cut (with card status and Approve), then flagged scenes that play. */
function ScenesView({ scenes, snap, position, rowProps, logger, onSettings }) {
  const { error, busy, setBusy, setError, write } = useFilterWrite(logger);
  const rk = snap.ratingKey;
  const urlOf = (m) => `/api/v1/content-filter/${encodeURIComponent(rk)}/${m.kind === 'scene' ? 'scenes' : 'cues'}/${encodeURIComponent(m.id)}`;

  const approve = (m, text) => write(
    () => DaylightAPI(urlOf(m), { card: { approve: true, text } }, 'PUT'),
    m.kind === 'scene' ? 'content-filter.card.approved' : 'content-filter.cue-card.approved',
    { ratingKey: rk, [m.kind === 'scene' ? 'scene' : 'cue']: m.id, from: 'rail-list' },
  );
  const draft = async (m) => {
    setBusy(true); setError('');
    logger.info('content-filter.card.requested', { ratingKey: rk, id: m.id, kind: m.kind, from: 'rail-list' });
    try {
      await DaylightAPI(`${urlOf(m)}/card`, {}, 'POST');
      logger.info('content-filter.card.drafted', { ratingKey: rk, id: m.id, kind: m.kind, from: 'rail-list' });
      await previewStore.refresh();
    } catch (e) {
      setError(`Could not draft a card: ${errText(e)}`);
      logger.warn('content-filter.workshop.failed', { ratingKey: rk, id: m.id, error: errText(e) });
    } finally { setBusy(false); }
  };

  return (
    <>
      <section className="filter-rail__section">
        <h4>Skipped or hidden</h4>
        {scenes.cut.length ? (
          <ul className="filter-rail__list is-scenes" data-testid="filter-rail-scenes">
            {scenes.cut.map((m) => {
              const card = cardOf(m, snap.override);
              const lines = m.scene ? levelLines(m.scene) : [categoryText(m.category)].filter(Boolean);
              return (
                <li key={m.key} className="filter-rail__scene" data-testid="filter-rail-scene">
                  <ul className="filter-rail__list">
                    <MomentRow {...rowProps(m)} sub={`${effectChip(m.effect)}, ${spanText(m)}`} time={m.in > position ? awayText(m.in - position) : clock(m.in)} past={m.in <= position} />
                  </ul>
                  <div className="filter-rail__scene-body">
                    {lines.map((l) => <p key={l} className="filter-rail__levels">{l}</p>)}
                    <div className="filter-rail__cardline">
                      <span className={`filter-rail__card-status is-${card.status}`} data-testid="filter-rail-card-status">
                        {card.status === 'approved' ? 'Card approved' : card.status === 'draft' ? 'Card drafted, not approved' : 'No card yet'}
                      </span>
                      {card.status === 'draft' ? (
                        <button type="button" className="filter-rail__btn is-small" disabled={busy} onClick={() => approve(m, card.text)}>Approve card</button>
                      ) : card.status === 'none' ? (
                        <button type="button" className="filter-rail__btn is-small" disabled={busy} onClick={() => draft(m)}>Draft card</button>
                      ) : null}
                    </div>
                    {card.text ? <p className="filter-rail__card-text">{card.text}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <>
            <p className="filter-rail__empty">
              No scene is skipped or hidden. Choose a flagged scene below to skip or hide it, or set Violence, Nudity or Sexual content to Blackout or Skip in Settings.
            </p>
            <button type="button" className="filter-rail__btn" onClick={onSettings}>Open settings</button>
          </>
        )}
        {error ? <div className="filter-rail__error" role="alert">{error}</div> : null}
      </section>

      {scenes.shown.length ? (
        <section className="filter-rail__section">
          <h4>Flagged scenes that play</h4>
          <p className="filter-rail__note">These play, with their own words and moments still muted or blurred. Choose one to skip or hide it.</p>
          <ul className="filter-rail__list" data-testid="filter-rail-shown">
            {scenes.shown.map((m) => (
              <MomentRow
                key={m.key}
                {...rowProps(m)}
                sub={levelLines(m.scene)[0] || spanText(m)}
                time={clock(m.in)}
                past={m.in <= position}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** The selection: what it is, when, what the viewer gets, and its actions and rulings. */
function SelectedBlock({ m, sel, logger }) {
  const effect = m ? m.effect : sel?.effect;
  const label = m ? rowLabel(m) : rowLabel(sel);
  const id = m ? m.id : baseId(sel?.id ?? '');
  const lines = m?.scene ? levelLines(m.scene) : [categoryText(m?.category ?? sel?.category)].filter(Boolean);
  const inSec = m ? m.in : sel?.in;
  return (
    <section className={`filter-rail__selected is-${effect ? kindOf(effect) : 'shown'}`} data-testid="filter-rail-selected" aria-label="Selected">
      <div className="filter-rail__selected-head">
        <Glyph effect={effect} />
        <span className="filter-rail__selected-title">{label}</span>
        <button type="button" className="filter-rail__close is-small" aria-label="Clear selection" onClick={() => previewStore.publish({ selected: null })}>
          <CloseIcon />
        </button>
      </div>
      <p className="filter-rail__selected-when">
        <span className="filter-rail__chip">{effect ? effectChip(effect) : 'Plays'}</span>
        {m ? spanText(m) : clock(inSec)}
      </p>
      {lines.map((l) => <p key={l} className="filter-rail__levels">{l}</p>)}
      <p className="filter-rail__note">{effect ? effectSentence(effect) : 'The scene plays. Its own words and moments are still muted or blurred.'}</p>
      <div className="filter-rail__buttons">
        <button type="button" className="filter-rail__btn" onClick={() => { previewStore.jumpToCue({ in: inSec }); logger.info('filter-rail.jump', { id, again: true }); }}>Jump there</button>
        {effect ? (
          <button
            type="button"
            className="filter-rail__btn"
            aria-label="Peek unfiltered"
            onClick={() => { previewStore.peek(id); logger.info('filter-rail.peek', { id }); }}
          >
            Peek unfiltered
          </button>
        ) : null}
      </div>
      {effect ? <p className="filter-rail__note">{`Peek plays it once without the filter, from ${PREVIEW_LEAD_SEC} s before, then the filter is back on.`}</p> : null}
      <WorkshopPanel />
    </section>
  );
}
