import { ActionIcon, Switch, Tooltip } from '@mantine/core';
import {
  IconBulb, IconPlug, IconTemperature, IconWalk, IconDoor, IconDeviceTv,
  IconBattery2, IconToggleLeft, IconGauge, IconDots, IconExternalLink,
} from '@tabler/icons-react';
import { formatEntityState, formatAge } from './formatEntityState.js';
import './EntityTile.scss';

const TYPE_ICONS = {
  light: IconBulb, power: IconPlug, climate: IconTemperature, presence: IconWalk,
  openings: IconDoor, media: IconDeviceTv, battery: IconBattery2, switch: IconToggleLeft, sensor: IconGauge,
};

/** HA's history page is the one entity deep link that works on every install. */
export function haEntityLink(haUrl, entityId) {
  return haUrl ? `${haUrl}/history?entity_id=${encodeURIComponent(entityId)}` : null;
}

/**
 * One entity: what it is, where it is, what it's doing — and a switch when the
 * household lets the dashboard control it.
 *
 * @param {Object} props
 * @param {Object} props.entity - entity JSON from /home-dashboard/entities
 * @param {'type'|'room'|'state'} props.view - decides which context line to show
 * @param {string|null} props.haUrl
 * @param {(entity: Object) => void} props.onToggle
 */
export function EntityTile({ entity, view, haUrl, onToggle }) {
  const Icon = TYPE_ICONS[entity.type] || IconDots;
  const stateText = formatEntityState(entity);
  const age = formatAge(entity.lastChanged);
  // The view already says the type (or room); show the other one.
  const context = view === 'room' ? null : (entity.room?.name || null);
  const link = haEntityLink(haUrl, entity.id);

  return (
    <div
      className={`home-entity home-entity--${entity.stateClass}${entity.pending ? ' home-entity--pending' : ''}`}
      data-entity-id={entity.id}
    >
      <Icon className="home-entity__icon" size={20} stroke={1.75} aria-hidden="true" />
      <div className="home-entity__body">
        <div className="home-entity__name" title={entity.id}>{entity.name}</div>
        <div className="home-entity__meta">
          {context ? (
            entity.room?.source === 'inferred'
              ? <span className="home-entity__inferred" title="Room guessed from the entity name">{context}</span>
              : <span>{context}</span>
          ) : null}
          {age ? <span>{age}</span> : null}
        </div>
      </div>
      <div className="home-entity__state tabular-nums">{stateText}</div>
      {entity.controllable ? (
        <Switch
          className="home-entity__switch"
          checked={entity.stateClass === 'on'}
          onChange={() => onToggle(entity)}
          disabled={Boolean(entity.pending)}
          aria-label={`${entity.name}: turn ${entity.stateClass === 'on' ? 'off' : 'on'}`}
          size="md"
        />
      ) : null}
      {link ? (
        <Tooltip label="Open in Home Assistant" openDelay={400}>
          <ActionIcon
            component="a"
            href={link}
            target="_blank"
            rel="noreferrer"
            variant="subtle"
            size="sm"
            aria-label={`Open ${entity.name} in Home Assistant`}
            className="home-entity__link"
          >
            <IconExternalLink size={14} />
          </ActionIcon>
        </Tooltip>
      ) : null}
    </div>
  );
}

export default EntityTile;
