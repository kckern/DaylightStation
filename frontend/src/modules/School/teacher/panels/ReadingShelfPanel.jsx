/**
 * ReadingShelfPanel — a grown-up's view of one child's reading shelf
 * (teacher reading admin design §2 and §6).
 *
 * Still the observation half of the surface: it answers what this child is
 * reading, how much, and how consistently, and NOTHING on it writes. Each row
 * carries one control, and it opens that reading's detail — where every verb
 * lives, so the list stays scannable and no destructive control sits under a
 * browsing thumb.
 *
 * It reads the SAME view the child's own panel reads — one `GetBookShelf`,
 * server-computed projections — so the two surfaces cannot disagree about a
 * child's year. Titles, authors and covers go through the same `presentBook`
 * and `BookCover` the shelf uses; the day and duration formatters are
 * `ShelfTile`'s own exports. This file derives nothing it could import.
 *
 * ## The failure that matters (design §6)
 *
 * An unreadable shelf must render as a NAMED ERROR, never as an empty shelf.
 * A damaged year of a child's evidence presented as "No books yet" is a
 * grown-up starting to "fix" a record that was only unreadable. So the fetch
 * refuses a 200 whose body is not a shelf — no `items` array, no shelf — and
 * that lands in `error` with the server's own sentence where it gave one.
 */
import { useEffect, useMemo, useRef } from 'react';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import BookCover from '../../books/BookCover.jsx';
import { presentBook } from '../../books/bookPresentation.js';
import { formatMinutes, shortDay } from '../../books/ShelfTile.jsx';

/**
 * The obligation strip's HEADING for the counted window. Deliberately not
 * `BookShelf`'s `WINDOW_WORD`: that one is a sentence suffix a child reads
 * inline ("4 of 7 days this week"), this one is a column heading over the
 * number. Same fact, two grammars.
 */
const WINDOW_TITLE = { day: 'Today', week: 'This week', month: 'This month' };

const MODE_WORD = { page: 'page mode', minutes: 'minutes mode', check: 'check-in mode' };

/** A book that is open — logged against or not — is on the shelf. */
const GROUPS = [
  { key: 'reading', title: 'Reading now', statuses: ['reading', 'unread'] },
  { key: 'finished', title: 'Finished', statuses: ['finished'] },
  { key: 'set-aside', title: 'Set aside', statuses: ['set-aside'] },
];

const statusOf = (item) => item?.projection?.status ?? 'reading';

/** The mode's own number, the way the child's tile states it. */
function progressLabel(item) {
  const projection = item?.projection ?? {};
  if (statusOf(item) === 'finished') {
    const day = shortDay(projection.lastAt);
    return day ? `finished ${day}` : 'finished';
  }
  if (statusOf(item) === 'set-aside') {
    const day = shortDay(projection.lastAt);
    return day ? `set aside ${day}` : 'set aside';
  }
  if (item?.progressMode === 'minutes') {
    return projection.minutes > 0 ? formatMinutes(projection.minutes) : 'not yet logged';
  }
  if (item?.progressMode === 'check') {
    return projection.daysRead > 0
      ? `${projection.daysRead} ${projection.daysRead === 1 ? 'day' : 'days'}`
      : 'not yet logged';
  }
  if (!Number.isFinite(projection.page)) return 'not yet logged';
  return Number.isFinite(item?.pageCount) && item.pageCount > 0
    ? `p. ${projection.page} / ${item.pageCount}`
    : `p. ${projection.page}`;
}

/** `page mode · last logged Sep 3 · 6 days read` — the provenance line. */
function metaLine(item) {
  const projection = item?.projection ?? {};
  const parts = [MODE_WORD[item?.progressMode] ?? MODE_WORD.page];
  const day = shortDay(projection.lastAt);
  if (day) parts.push(`last logged ${day}`);
  if (projection.daysRead > 0) {
    parts.push(`${projection.daysRead} ${projection.daysRead === 1 ? 'day' : 'days'} read`);
  }
  return parts.join(' · ');
}

function Bar({ percent, label }) {
  const value = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return (
    <div
      className="teacher-reading__bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className="teacher-reading__bar-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

function Reading({ item, onOpen }) {
  const presentation = presentBook(item);
  const projection = item.projection ?? {};
  const showBar = statusOf(item) === 'reading'
    && item.progressMode === 'page' && Number.isFinite(projection.percent);
  return (
    <li className="teacher-reading__row">
      <BookCover book={item} className="teacher-reading__cover" loading="lazy" />
      <div className="teacher-reading__row-body">
        <p className="teacher-reading__row-title">{presentation.title}</p>
        {presentation.author && (
          <p className="teacher-reading__row-author" title={presentation.allAuthors}>{presentation.author}</p>
        )}
        <p className="teacher-reading__row-meta">{metaLine(item)}</p>
        {showBar && <Bar percent={projection.percent} label={`${Math.round(projection.percent)}% read`} />}
      </div>
      <p className="teacher-reading__row-progress">{progressLabel(item)}</p>
      {onOpen && (
        <button
          type="button"
          className="teacher-reading__row-open"
          aria-label={`Open ${presentation.title}`}
          onClick={() => onOpen(item.itemId)}
        >
          ⋯
        </button>
      )}
    </li>
  );
}

function ObligationStrip({ obligation, counts }) {
  const label = typeof obligation?.label === 'string' ? obligation.label.trim() : '';
  const target = Number(obligation?.target);
  const actual = Number(obligation?.actual);
  const percent = Number.isFinite(target) && target > 0 ? (actual / target) * 100 : null;
  return (
    <div className="teacher-reading__summary">
      {label && (
        <div className="teacher-reading__obligation">
          <p className="teacher-reading__obligation-window">{WINDOW_TITLE[obligation.per] ?? 'So far'}</p>
          <p className="teacher-reading__obligation-label" data-met={obligation.met === true ? 'yes' : 'no'}>{label}</p>
          {percent !== null && <Bar percent={percent} label={`${label} of the reading obligation`} />}
        </div>
      )}
      <p className="teacher-reading__counts">
        {`Reading now ${counts.reading} · Finished ${counts.finished} · Set aside ${counts['set-aside']}`}
      </p>
    </div>
  );
}

/** A body that is not a shelf is not an empty shelf. */
const isShelf = (data) => Boolean(data) && typeof data === 'object' && Array.isArray(data.items);

/**
 * @param {object} props
 * @param {string} props.learnerId
 * @param {number} props.refreshToken - bumped by the workspace after a
 *   correction, so the shelf re-reads instead of showing counts the edit
 *   already changed.
 * @param {Function|null} props.onOpenReading - opens one reading's detail.
 *   Absent means a read-only shelf, which is what an install with no edit
 *   surface gets.
 * @param {Function|null} props.onShelf - reports `{state, obligation, studyDay}`
 *   upward as the read settles. The workspace needs BOTH: the state, because a
 *   shelf that cannot be read must lock the edit surface entirely (design §6),
 *   and the obligation, because the window it is measured over is what decides
 *   whether re-dating a day takes it off the child's total.
 */
export default function ReadingShelfPanel({
  learnerId, refreshToken = 0, onOpenReading = null, onShelf = null,
}) {
  // usePanelFetch reports the STATE, not the server's words; the sentence a
  // refusal came with is kept here so the error can name what happened
  // instead of saying only that something did.
  const faultRef = useRef(null);

  const fetcher = useMemo(() => async () => {
    const response = await teacherWorkspaceApi.readingShelf(learnerId);
    if (!response.ok) {
      faultRef.current = typeof response.data?.error === 'string' ? response.data.error : null;
      return response;
    }
    if (!isShelf(response.data)) {
      teacherLog.fetch('reading-shelf-unreadable', { panel: 'reading-shelf', learnerId, status: response.status });
      faultRef.current = 'This shelf couldn’t be read. Nothing here is safe to act on yet.';
      // Deliberately not 404: an install without the route is `unavailable`,
      // and a shelf that answered but made no sense is neither that nor empty.
      return { ok: false, status: response.status, data: null };
    }
    faultRef.current = null;
    return response;
  }, [learnerId]);

  const { state, data, retry } = usePanelFetch(fetcher, {
    deps: [learnerId, refreshToken],
    isEmpty: (payload) => isShelf(payload) && payload.items.length === 0,
    notFoundAs: 'unavailable',
    panel: 'reading-shelf',
  });

  const items = isShelf(data) ? data.items : [];
  const counts = useMemo(() => {
    const tally = { reading: 0, finished: 0, 'set-aside': 0 };
    for (const item of items) {
      const group = GROUPS.find((candidate) => candidate.statuses.includes(statusOf(item)));
      if (group) tally[group.key] += 1;
    }
    return tally;
  }, [items]);

  // Held in a ref so a caller passing an inline arrow does not re-run the
  // report on every render of the workspace above.
  const reportRef = useRef(onShelf);
  reportRef.current = onShelf;
  useEffect(() => {
    reportRef.current?.({
      state,
      obligation: isShelf(data) ? data.obligation ?? null : null,
      studyDay: isShelf(data) ? data.studyDay ?? null : null,
    });
  }, [state, data]);

  useEffect(() => { teacherLog.read('reading-opened', { learnerId }); }, [learnerId]);
  useEffect(() => {
    if (state === 'loading') return;
    teacherLog.read('reading-shelf', { learnerId, state, ...counts });
  }, [learnerId, state, counts]);

  return (
    <PanelFrame
      title="Reading"
      state={state}
      retry={retry}
      emptyCopy="No books yet."
      errorCopy={state === 'error' ? faultRef.current : null}
      unavailableCopy="The reading shelf is not available on this install."
    >
      <div className="teacher-reading">
        <ObligationStrip obligation={data?.obligation ?? null} counts={counts} />
        {GROUPS.map((group) => {
          const rows = items.filter((item) => group.statuses.includes(statusOf(item)));
          if (rows.length === 0) return null;
          return (
            <section key={group.key} className="teacher-reading__group">
              <h3 className="teacher-reading__group-title">{group.title}</h3>
              <ul className="teacher-reading__list">
                {rows.map((item) => (
                  <Reading key={item.itemId} item={item} onOpen={onOpenReading} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </PanelFrame>
  );
}
