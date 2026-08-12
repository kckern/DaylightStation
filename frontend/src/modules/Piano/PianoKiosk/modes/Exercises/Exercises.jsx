import { useCallback, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import usePianoList from '../../usePianoList.js';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonGrid } from '../../Skeleton.jsx';
import ExerciseRun from './ExerciseRun.jsx';
import { buildSearchPath, describeInstance, groupByLevel } from './exerciseQuery.js';
import {
  DEFAULT_FILTERS, FORM_OPTIONS, HAND_OPTIONS, LEVEL_BANDS, MODE_OPTIONS,
} from './filters.js';
import './Exercises.scss';

/**
 * Exercises — browses the exercise bank.
 *
 * The bank stores seeds and computes instances, so what is browsed here is not
 * a list of files: it is a query. Levels are the spine of it, because a player
 * needs "something I can nearly do", not "everything that exists".
 *
 * Replaces the old Lessons mode, which could only ever show the one Hanon
 * collection it was hard-wired to.
 */
export function Exercises() {
  return (
    <Routes>
      <Route index element={<ExerciseBrowser />} />
      <Route path="run/*" element={<ExerciseRunRoute />} />
    </Routes>
  );
}

function ExerciseRunRoute() {
  const navigate = useNavigate();
  const params = useParams();
  // The instance id contains slashes and an @, so it rides in a splat.
  const instanceId = params['*'] ? decodeURIComponent(params['*']) : null;
  return <ExerciseRun instanceId={instanceId} onExit={() => navigate('..', { relative: 'path' })} />;
}

function ExerciseBrowser() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-exercises' }), []);
  const navigate = useNavigate();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const path = useMemo(() => buildSearchPath(filters), [filters]);
  const { data, error } = usePianoList(path, (r) => r ?? null);

  const set = useCallback((patch) => {
    setFilters((current) => {
      const next = { ...current, ...patch };
      logger.debug('piano.exercises.filter', next);
      return next;
    });
  }, [logger]);

  const bands = useMemo(() => groupByLevel(data?.instances ?? [], filters.mode), [data, filters.mode]);
  const facets = data?.facets ?? { level: {}, form: {}, collection: {} };
  const total = data?.total ?? 0;

  if (error) return <PianoEmpty title="Exercises unavailable" hint={String(error.message || error)} />;

  return (
    <section className="piano-exercises">
      <header className="piano-exercises__head">
        <h1 className="piano-exercises__title">Exercises</h1>
        <p className="piano-exercises__count">
          {data ? `${total} to choose from` : 'Counting…'}
        </p>
      </header>

      <div className="piano-exercises__filters">
        <FilterRow label="How strict">
          {MODE_OPTIONS.map((option) => (
            <Chip
              key={option.id}
              active={filters.mode === option.id}
              onClick={() => set({ mode: option.id })}
              title={option.blurb}
            >
              {option.label}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Level">
          {LEVEL_BANDS.map((band) => {
            // A band with nothing in it is shown but not offered — knowing it is
            // empty is more useful than it silently vanishing.
            const count = countInBand(facets.level, band);
            return (
              <Chip
                key={band.id}
                active={filters.levelMin === band.min && filters.levelMax === band.max}
                disabled={band.id !== 'any' && count === 0}
                onClick={() => set({ levelMin: band.min, levelMax: band.max })}
              >
                {band.label}
                {band.id !== 'any' && <span className="piano-exercises__chip-count">{count}</span>}
              </Chip>
            );
          })}
        </FilterRow>

        <FilterRow label="Kind">
          {FORM_OPTIONS.map((option) => (
            <Chip
              key={option.id ?? 'all'}
              active={filters.form === option.id}
              disabled={Boolean(option.id) && !facets.form[option.id]}
              onClick={() => set({ form: option.id })}
            >
              {option.label}
              {option.id && <span className="piano-exercises__chip-count">{facets.form[option.id] ?? 0}</span>}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Hands">
          {HAND_OPTIONS.map((option) => (
            <Chip
              key={option.id ?? 'any'}
              active={filters.hands === option.id}
              onClick={() => set({ hands: option.id })}
            >
              {option.label}
            </Chip>
          ))}
        </FilterRow>
      </div>

      {!data && <SkeletonGrid />}

      {data && total === 0 && (
        <PianoEmpty
          title="Nothing at that level"
          hint="Try a wider level band, or a less strict mode."
        />
      )}

      {data && bands.map(({ level, items }) => (
        <div key={level} className="piano-exercises__band">
          <h2 className="piano-exercises__band-title">
            Level {level}
            <span className="piano-exercises__band-count">{items.length}</span>
          </h2>
          <ul className="piano-exercises__grid">
            {items.map((instance) => (
              <li key={instance.id}>
                <button
                  type="button"
                  className="piano-exercises__card"
                  onClick={() => {
                    logger.info('piano.exercise-open', { id: instance.id, level, mode: filters.mode });
                    navigate(`run/${encodeURIComponent(instance.id)}?mode=${filters.mode}`);
                  }}
                >
                  <span className="piano-exercises__card-title">{instance.title}</span>
                  <span className="piano-exercises__card-detail">{describeInstance(instance)}</span>
                  <span className="piano-exercises__card-meta">
                    <span>{instance.shape.events} note{instance.shape.events === 1 ? '' : 's'}</span>
                    <span>{instance.staff}</span>
                    <span>{instance.shape.hands}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {data && total > (data.instances?.length ?? 0) && (
        <p className="piano-exercises__more">
          Showing {data.instances.length} of {total}. Narrow the level or kind to see the rest.
        </p>
      )}
    </section>
  );
}

function countInBand(levelFacets, band) {
  let total = 0;
  for (let level = band.min; level <= band.max; level += 1) total += levelFacets[level] ?? 0;
  return total;
}

function FilterRow({ label, children }) {
  return (
    <div className="piano-exercises__filter-row">
      <span className="piano-exercises__filter-label">{label}</span>
      <div className="piano-exercises__chips">{children}</div>
    </div>
  );
}

function Chip({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      className={`piano-exercises__chip${active ? ' piano-exercises__chip--active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export default Exercises;
