import { useMemo, useState } from 'react';
import { SegmentedControl, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { EmptyState } from '@/lib/ui';
import { BROWSE_MODES, groupEntities, filterEntities } from '../entities/groupEntities.js';
import { EntityRow } from '../ui/EntityRow.jsx';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import homeLogger from '../homeLogger.js';
import '../ui/home-ui.scss';
import './BrowseView.scss';

const logger = homeLogger.child({ component: 'browse' });
const MODE_KEY = 'home.browse.mode';

function readSavedMode() {
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    return BROWSE_MODES.some((m) => m.id === saved) ? saved : 'type';
  } catch { return 'type'; }
}
function saveMode(mode) {
  try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable */ }
}

/**
 * Every entity, as a dense searchable list grouped by type, room or state.
 * Switches only on lights; everything else is a tap away in the detail sheet.
 */
export function BrowseView({ entities, rooms, types, stateClasses, haUrl, toggle }) {
  const [mode, setMode] = useState(readSavedMode);
  const [query, setQuery] = useState('');
  const [showUnavailable, setShowUnavailable] = useState(false);
  const detail = useEntityDetail(entities);
  const typeLabel = (type) => types.find((t) => t.id === type)?.label;

  // The state grouping exists partly to show what is not answering, so it never hides it.
  const hiding = !showUnavailable && mode !== 'state';
  const unavailableCount = useMemo(() => entities.filter((e) => e.stateClass === 'unavailable').length, [entities]);
  const visible = useMemo(() => filterEntities(entities, { query, hideUnavailable: hiding }), [entities, query, hiding]);
  const groups = useMemo(() => groupEntities(visible, mode, { rooms, types, stateClasses }), [visible, mode, rooms, types, stateClasses]);

  const changeMode = (next) => {
    logger.debug('home.browse.mode', { from: mode, to: next });
    setMode(next);
    saveMode(next);
  };
  const changeQuery = (value) => {
    setQuery(value);
    if (value.trim()) logger.sampled('home.browse.search', { length: value.trim().length }, { maxPerMinute: 10, aggregate: true });
  };

  // What the second line says depends on what the grouping already says.
  const subFor = (e) => {
    if (mode === 'room') return typeLabel(e.type) || null;
    return e.room?.name || null;
  };

  return (
    <div className="home-browse">
      <div className="home-browse__toolbar">
        <TextInput
          className="home-browse__search"
          placeholder="Find a light, a room, a sensor"
          leftSection={<IconSearch size={16} aria-hidden="true" />}
          value={query}
          onChange={(ev) => changeQuery(ev.currentTarget.value)}
          aria-label="Find an entity"
          size="md"
        />
        <SegmentedControl
          className="home-browse__mode"
          value={mode}
          onChange={changeMode}
          data={BROWSE_MODES.map((m) => ({ value: m.id, label: m.label }))}
          aria-label="Group by"
          size="md"
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={query ? 'Nothing matches that' : 'No entities to show'}
          hint={query ? 'Try a room or device name.' : 'Check the entities section of the home dashboard config.'}
        />
      ) : (
        groups.map((group) => (
          <section key={group.id} className="home-browse__group" aria-label={group.label}>
            <h2 className="home-browse__heading">
              <span>{group.label}</span>
              <span className="home-browse__count">{group.onCount ? `${group.onCount} on, ` : ''}{group.entities.length}</span>
            </h2>
            <div className="home-rows--ruled">
              {group.entities.map((e) => (
                <EntityRow key={e.id} entity={e} sub={subFor(e)} control={e.type === 'light' ? 'switch' : null} onToggle={toggle} onOpen={detail.open} />
              ))}
            </div>
          </section>
        ))
      )}

      {hiding && unavailableCount ? (
        <UnstyledButton className="home-textaction home-browse__unavailable" onClick={() => { logger.debug('home.browse.show-unavailable', { count: unavailableCount }); setShowUnavailable(true); }}>
          Show {unavailableCount} not answering
        </UnstyledButton>
      ) : null}
      {showUnavailable && mode !== 'state' ? (
        <UnstyledButton className="home-textaction home-browse__unavailable" onClick={() => setShowUnavailable(false)}>
          Hide the ones not answering
        </UnstyledButton>
      ) : null}

      <EntityDetailSheet entity={detail.selected} haUrl={haUrl} onToggle={toggle} onClose={detail.close} typeLabel={detail.selected ? typeLabel(detail.selected.type) : null} />
    </div>
  );
}

export default BrowseView;
