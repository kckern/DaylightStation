import { useMemo, useState } from 'react';
import { Switch, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { SectionCard, LoadingState, ErrorState, EmptyState } from '@/lib/ui';
import { groupEntities, filterEntities } from './groupEntities.js';
import { EntityTile } from './EntityTile.jsx';
import { useHomeEntities } from './useHomeEntities.js';
import './EntityDashboard.scss';

/**
 * Every Home Assistant entity the household's dashboard policy admits, grouped
 * by type, room or state.
 *
 * @param {Object} props
 * @param {'type'|'room'|'state'} props.view
 */
export function EntityDashboard({ view }) {
  const { entities, rooms, types, stateClasses, haUrl, hasData, loading, error, reload, toggle } = useHomeEntities();
  const [query, setQuery] = useState('');
  const [hideUnavailable, setHideUnavailable] = useState(true);

  // The state view exists partly to show what is not answering, so it never hides it.
  const hiding = hideUnavailable && view !== 'state';
  const visible = useMemo(() => filterEntities(entities, { query, hideUnavailable: hiding }), [entities, query, hiding]);
  const groups = useMemo(
    () => groupEntities(visible, view, { rooms, types, stateClasses }),
    [visible, view, rooms, types, stateClasses],
  );
  const onCount = visible.filter((e) => e.stateClass === 'on').length;

  if (!hasData && loading) return <LoadingState label="home entities" rows={6} />;
  // A failed poll keeps the last good reading on screen; only a first load
  // with nothing to show is a dead end.
  if (!hasData && error) return <ErrorState error={error} onRetry={reload} label="Home Assistant" />;

  return (
    <div className="home-entities">
      <div className="home-entities__toolbar">
        <TextInput
          className="home-entities__search"
          placeholder="Find a light, a room, a sensor…"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(ev) => setQuery(ev.currentTarget.value)}
          aria-label="Find an entity"
        />
        {view !== 'state' ? (
          <Switch
            label="Hide unavailable"
            checked={hideUnavailable}
            onChange={(ev) => setHideUnavailable(ev.currentTarget.checked)}
          />
        ) : null}
        <span className="home-entities__summary tabular-nums">
          {visible.length} shown · {onCount} on
          {error ? <span className="home-entities__stale"> · not refreshing</span> : null}
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={query ? 'Nothing matches that' : 'No entities to show'}
          hint={query ? 'Try a room or device name.' : 'Check the entities section of the home dashboard config.'}
        />
      ) : (
        <div className="home-entities__groups">
          {groups.map((group) => (
            <SectionCard
              key={group.id}
              title={group.label}
              actions={(
                <span className="home-entities__count tabular-nums">
                  {group.onCount ? `${group.onCount} on · ` : ''}{group.entities.length}
                </span>
              )}
            >
              <div className="home-entities__grid">
                {group.entities.map((entity) => (
                  <EntityTile key={entity.id} entity={entity} view={view} haUrl={haUrl} onToggle={toggle} />
                ))}
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

export default EntityDashboard;
