import { useRef, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { MacroBadges } from './MacroBadges.jsx';
import { DensityBadge } from './DensityBadge.jsx';
import { useHealthDisplayPreferences } from '../display/HealthDisplayPreferences.jsx';
import { nutritionPhotoUrl } from './photoUrl.js';
import { FoodIcon } from './FoodIcon.jsx';
import { PortionControl } from './PortionControl.jsx';
import { entryId, entryError, isEntryConflict, updateEntry } from './entryCommands.js';
import { usePortionControl } from './usePortionDraft.js';

const logger = createAppLogger('health').child('entry-row');

export function EntryRow({ row, densityRow = row, onTap, onConfirm, isGroup = false, expanded = false, onToggle, rollupKcal, child = false, lastChild = false, measured = null }) {
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const pending = useRef(false);
  const operation = useRef(null);
  const [brokenPhoto, setBrokenPhoto] = useState(null);
  const portions = usePortionControl();
  const { densityPlacement } = useHealthDisplayPreferences();
  const unsettled = row.settled === false || (isGroup && row.children?.some(item => item.settled === false));
  const name = row.name || row.item || row.label || '';
  const displayKcal = isGroup ? rollupKcal : row.calories;
  const confirm = async () => {
    if (pending.current || confirmation === 'saved') return;
    pending.current = true; setConfirmation('saving'); setError(null);
    operation.current ??= { id: crypto.randomUUID(), row };
    try {
      await updateEntry(operation.current.row, { settled: true }, operation.current.id);
      setConfirmation('saved'); logger.info('entry.confirm', { uuid: entryId(row) }); onConfirm?.(row);
    } catch (err) {
      setConfirmation(null); setError(entryError(err));
      if (isEntryConflict(err)) { operation.current = null; onConfirm?.(row); }
      logger.warn('entry.confirm_failed', { uuid: entryId(row), error: err.message });
    } finally { pending.current = false; }
  };
  return <div className={['health-row-line', unsettled && confirmation !== 'saved' && 'health-row-line--unsettled', child && 'health-row-line--child', lastChild && 'health-row-line--last-child', isGroup && 'health-row-line--group'].filter(Boolean).join(' ')}>
    <div className="health-row__branch">
      {isGroup ? <UnstyledButton className="health-row__expand" aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} onClick={onToggle}><svg className="health-row__triangle" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d={expanded ? 'M0 0H10L5 10Z' : 'M0 0L10 5L0 10Z'} fill="currentColor" />
        </svg></UnstyledButton> : null}
    </div>
    <div className={`health-row-identity health-row__identity health-row__visual health-density-${densityPlacement}`}>
      {densityPlacement === 'before' ? <DensityBadge row={densityRow} /> : null}
      <span className="health-row-artwork">{row.photoRef && brokenPhoto !== row.photoRef ? <img className="health-row__thumb"
        src={nutritionPhotoUrl(row.photoRef, { thumb: true })} alt="" loading="lazy" onError={() => setBrokenPhoto(row.photoRef)} /> : <FoodIcon icon={row.icon} />}</span>
      <UnstyledButton className="health-row-name" disabled={Boolean(portions?.draft)} onClick={() => onTap(row)} aria-label={`Edit ${name}`}>
      <span className="health-row__description" title={name}><span className="health-row__name">{name}</span>{' '}
        {measured ? <span className="health-row__scale" title={measured}> · Scale ✓</span> : null}
      </span>
      </UnstyledButton>
      {densityPlacement === 'after' ? <DensityBadge row={densityRow} /> : null}
    </div>
    <MacroBadges rows={isGroup ? row.children : [row]} className="health-row__macros health-row__visual" />
    <span className="health-row__portion-cell health-row__visual"><PortionControl row={row} /></span>
    <span className="health-row__kcal health-row__visual" title="Calories">{displayKcal == null ? '—' : Math.round(displayKcal)}<small> kcal</small></span>
    <div className="health-row__action health-row__visual">
      {confirmation === 'saved' ? <span role="status" aria-label={`${name} confirmed`} title="Confirmed">✓</span> : unsettled ?
        <UnstyledButton className="health-row__confirm" aria-label={`Confirm entry: ${name}`} title="Confirm this estimate"
          disabled={confirmation === 'saving' || Boolean(portions?.draft)} aria-busy={confirmation === 'saving'} onClick={confirm}>{confirmation === 'saving' ? '…' : '✓'}</UnstyledButton> : null}
    </div>
    {error ? <span role="alert" className="health-row__error">{error}</span> : null}
  </div>;
}
export default EntryRow;
