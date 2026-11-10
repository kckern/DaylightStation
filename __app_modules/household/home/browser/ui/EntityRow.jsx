import { Switch, UnstyledButton } from '@mantine/core';
import { displayName, formatEntityState } from '../entities/formatEntityState.js';
import './home-ui.scss';

/**
 * One line for one entity: name, a quiet second line, the state on the right,
 * and — only when control is both allowed and worth having here — a switch or
 * a plain "Off". Tapping the line opens the detail sheet when `onOpen` is given.
 *
 * @param {Object} props
 * @param {Object} props.entity
 * @param {string|null} [props.sub] - the second line; defaults to nothing
 * @param {string} [props.value] - overrides the formatted state
 * @param {string} [props.name] - overrides the entity's name
 * @param {boolean} [props.plain] - no lit/silent colouring (the section already says it)
 * @param {'switch'|'off'|null} [props.control] - which control to show for a controllable entity
 * @param {(entity: Object) => void} [props.onToggle]
 * @param {(entity: Object) => void} [props.onOpen]
 */
export function EntityRow({ entity, sub = null, value, name, plain = false, control = null, onToggle, onOpen }) {
  const lit = !plain && entity.stateClass === 'on' && (entity.type === 'light' || entity.type === 'power' || entity.type === 'media');
  const silent = !plain && entity.stateClass === 'unavailable';
  const shown = name ?? displayName(entity);
  const text = value ?? formatEntityState(entity);
  const classes = ['home-row',
    lit ? 'home-row--lit' : '', silent ? 'home-row--silent' : '', entity.pending ? 'home-row--pending' : '',
    onOpen ? 'home-row--tappable' : ''].filter(Boolean).join(' ');
  const inferred = sub && entity.room?.source === 'inferred' && sub === entity.room?.name;

  const main = (
    <>
      <span className="home-row__text">
        <span className="home-row__name">{shown}</span>
        {sub ? <span className={`home-row__sub${inferred ? ' home-inferred' : ''}`}>{sub}</span> : null}
      </span>
      <span className="home-row__value">{text}</span>
    </>
  );

  const showControl = entity.controllable ? control : null;
  return (
    <div className={classes} data-entity-id={entity.id}>
      {onOpen ? (
        <UnstyledButton className="home-row__main" onClick={() => onOpen(entity)} aria-label={`${shown}, ${text}`}>
          {main}
        </UnstyledButton>
      ) : (
        <div className="home-row__main">{main}</div>
      )}
      {showControl === 'switch' ? (
        <div className="home-row__action">
          <Switch
            checked={entity.stateClass === 'on'}
            onChange={() => onToggle?.(entity)}
            disabled={Boolean(entity.pending)}
            aria-label={`${entity.name}: turn ${entity.stateClass === 'on' ? 'off' : 'on'}`}
            size="md"
          />
        </div>
      ) : null}
      {showControl === 'off' && entity.stateClass === 'on' ? (
        <div className="home-row__action">
          <UnstyledButton
            className="home-textaction"
            onClick={() => onToggle?.(entity)}
            disabled={Boolean(entity.pending)}
            aria-label={`${entity.name}: turn off`}
          >
            Off
          </UnstyledButton>
        </div>
      ) : null}
    </div>
  );
}

export default EntityRow;
