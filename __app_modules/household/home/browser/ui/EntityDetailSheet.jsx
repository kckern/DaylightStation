import { Switch } from '@mantine/core';
import { Sheet } from '@/lib/ui';
import { displayName, formatEntityState, formatSince } from '../entities/formatEntityState.js';
import './home-ui.scss';

const ROOM_SOURCE = { config: 'set in the dashboard config', provider: 'set in Home Assistant', inferred: 'guessed from the name' };

/** HA's history page is the one entity deep link that works on every install. */
export function haEntityLink(haUrl, entityId) {
  return haUrl ? `${haUrl}/history?entity_id=${encodeURIComponent(entityId)}` : null;
}

/**
 * Everything about one entity, on demand: the state in large type, where it
 * is and how we know, when it last changed, its id — a switch when the
 * household allows one — and, last, the link into Home Assistant.
 */
export function EntityDetailSheet({ entity, haUrl, onToggle, onClose, typeLabel }) {
  const open = Boolean(entity);
  if (!open) return null;
  const lit = entity.stateClass === 'on' && (entity.type === 'light' || entity.type === 'power' || entity.type === 'media');
  const silent = entity.stateClass === 'unavailable';
  const link = haEntityLink(haUrl, entity.id);
  const since = formatSince(entity.lastChanged);
  return (
    <Sheet open={open} onClose={onClose} title={displayName(entity)}>
      <div className={`home-detail${lit ? ' home-detail--lit' : ''}${silent ? ' home-detail--silent' : ''}`} data-entity-id={entity.id}>
        <p className="home-detail__state">{formatEntityState(entity)}</p>
        <dl className="home-detail__facts">
          <dt>Room</dt>
          <dd>{entity.room ? `${entity.room.name} (${ROOM_SOURCE[entity.room.source] || entity.room.source})` : 'Not placed in a room'}</dd>
          <dt>Kind</dt>
          <dd>{typeLabel || entity.type}</dd>
          {since ? <><dt>Changed</dt><dd>{since}</dd></> : null}
          <dt>Id</dt>
          <dd>{entity.id}</dd>
        </dl>
        {entity.controllable ? (
          <div className="home-detail__control">
            <span>{entity.stateClass === 'on' ? 'On' : 'Off'}</span>
            <Switch
              checked={entity.stateClass === 'on'}
              onChange={() => onToggle?.(entity)}
              disabled={Boolean(entity.pending)}
              aria-label={`${entity.name}: turn ${entity.stateClass === 'on' ? 'off' : 'on'}`}
              size="lg"
            />
          </div>
        ) : null}
        {link ? (
          <a className="home-detail__link" href={link} target="_blank" rel="noreferrer">Open in Home Assistant</a>
        ) : null}
      </div>
    </Sheet>
  );
}

export default EntityDetailSheet;
