import { useRef, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { MacroBadges } from './MacroBadges.jsx';
import { nutritionPhotoUrl } from './photoUrl.js';
import { FoodIcon } from './FoodIcon.jsx';
import { PortionControl } from './PortionControl.jsx';
import { entryId, entryError, isEntryConflict, updateEntry } from './entryCommands.js';
import { usePortionControl } from './usePortionDraft.js';

const logger = createAppLogger('health').child('entry-row');

export function EntryRow({ row, onTap, onConfirm, isGroup = false, expanded = false, onToggle, rollupKcal, child = false, lastChild = false, measured = null }) {
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const pending = useRef(false);
  const operation = useRef(null);
  const [brokenPhoto, setBrokenPhoto] = useState(null);
  const portions = usePortionControl();
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
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} onClick={onToggle}>{expanded ? '▾' : '▸'}</UnstyledButton> : null}
    </div>
    <UnstyledButton className="health-row__identity" disabled={Boolean(portions?.draft)} onClick={() => onTap(row)} aria-label={`Edit ${name}`}>
      {row.photoRef && brokenPhoto !== row.photoRef ? <img className="health-row__thumb"
        src={nutritionPhotoUrl(row.photoRef, { thumb: true })} alt="" loading="lazy" onError={() => setBrokenPhoto(row.photoRef)} /> : <FoodIcon icon={row.icon} />}
      <span className="health-row__description" title={name}><span className="health-row__name">{name}</span>{' '}
        {unsettled && confirmation !== 'saved' ? <span className="health-row__badge" title="Counted now; stabilizes automatically after 72 hours unless you confirm sooner.">Estimated</span> : null}
        {measured ? <span className="health-row__scale" title={measured}> · Scale ✓</span> : null}
      </span>
    </UnstyledButton>
    <MacroBadges rows={isGroup ? row.children : [row]} className="health-row__macros" />
    <PortionControl row={row} />
    <span className="health-row__kcal" title="Calories">{displayKcal == null ? '—' : Math.round(displayKcal)}<small> kcal</small></span>
    <div className="health-row__action">
      {confirmation === 'saved' ? <span role="status" aria-label={`${name} confirmed`} title="Confirmed">✓</span> : unsettled ?
        <UnstyledButton className="health-row__confirm" aria-label={`Confirm entry: ${name}`} title="Confirm this estimate"
          disabled={confirmation === 'saving' || Boolean(portions?.draft)} aria-busy={confirmation === 'saving'} onClick={confirm}>{confirmation === 'saving' ? '…' : '✓'}</UnstyledButton> : null}
    </div>
    {error ? <span role="alert" className="health-row__error">{error}</span> : null}
  </div>;
}
export default EntryRow;
