import { useMemo } from 'react';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { RingClips } from '../doorbell/RingClips.jsx';
import { PowerBreakdown } from './PowerBreakdown.jsx';

/** The lane's own entity, or a stand-in named for the lane when /entities no longer lists it. */
export function laneEntity(lane, entities) {
  const id = lane.entityIds?.primary;
  const found = entities.find((e) => e.id === id);
  if (found) return found;
  return {
    id, domain: id ? id.split('.')[0] : null, name: lane.label, state: 'unknown', stateClass: 'unknown',
    type: lane.kind, room: null, unit: null, deviceClass: null, lastChanged: null, controllable: false, detail: {},
  };
}

/**
 * A lane's drawer: the entity drawer for the lane's primary entity, plus what
 * the lane adds below its history — where the power goes, or the rings in the
 * shown range with their clips. A screen or a room has nothing to add: its
 * history chart is the watt trace or the on bars.
 */
export function LaneDetailSheet({ lane, entities, summary, haUrl, toggle, onClose, timeZone }) {
  const entity = useMemo(() => (lane ? laneEntity(lane, entities) : null), [lane, entities]);
  const marks = useMemo(() => (lane ? (lane.days || []).flatMap((d) => d.marks || []) : []), [lane]);
  if (!lane) return null;
  let extra = null;
  if (lane.kind === 'power') extra = <PowerBreakdown entities={entities} summary={summary} />;
  else if (lane.kind === 'events' && lane.camera) extra = <RingClips camera={lane.camera} marks={marks} timeZone={timeZone} />;
  return <EntityDetailSheet entity={entity} haUrl={haUrl} onToggle={toggle} onClose={onClose} extra={extra} />;
}

export default LaneDetailSheet;
