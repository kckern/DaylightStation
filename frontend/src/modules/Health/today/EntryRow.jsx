import { useMemo, useRef, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { MacroBadges } from './MacroBadges.jsx';
import { DensityBadge } from './DensityBadge.jsx';
import { useHealthDisplayPreferences } from '../display/HealthDisplayPreferences.jsx';
import { nutritionPhotoUrl } from './photoUrl.js';
import { FoodIcon } from './FoodIcon.jsx';
import { reportArtworkFailure } from './artworkLog.js';
import { PortionControl } from './PortionControl.jsx';
import { entryId, entryError, isEntryConflict, updateEntry } from './entryCommands.js';
import { usePortionControl } from './usePortionDraft.js';
import { PortionDraftAlert, portionAlertFor } from './PortionDraftAlert.jsx';
import { useRowPreview, logRowPreviewOpen } from './RowPreview.jsx';
import { useDraggableRow } from './mealDrag.jsx';
import { isReconstructedRow } from '@shared-contracts/nutrition/reconstruction.mjs';

const logger = createAppLogger('health').child('entry-row');

export function EntryRow({ row, densityRow = row, onTap, onConfirm, onRequestDelete, isGroup = false, expanded = false, onToggle, rollupKcal, child = false, lastChild = false, measured = null, kcalShare = null, added = false, entryKey = undefined, dragBucket = null, onRemoveFromDish = null, dishName = '', dishBusy = false }) {
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const pending = useRef(false);
  const operation = useRef(null);
  const [brokenPhoto, setBrokenPhoto] = useState(null);
  const portions = usePortionControl();
  const { densityPlacement } = useHealthDisplayPreferences();
  const unsettled = row.settled === false || (isGroup && row.children?.some(item => item.settled === false));
  const name = row.name || row.item || row.label || '';
  // A weight-derived backfill of an untracked day, not food anyone logged.
  const reconstructed = !isGroup && isReconstructedRow(row);
  const displayKcal = isGroup ? rollupKcal : row.calories;
  // The magnifier card: held closed while a portion drag owns the pointer.
  const previewContent = useMemo(() => ({ row, isGroup, kcal: displayKcal }), [row, isGroup, displayKcal]);
  // The page's one preview card (RowPreviewProvider), at the cursor.
  const preview = useRowPreview({ disabled: Boolean(portions?.draft), onOpen: () => logRowPreviewOpen(row), content: previewContent });
  // The row is its own drag handle (mealDrag.jsx): never an ingredient on its
  // own, never while a portion drag owns the pointer.
  const drag = useDraggableRow(row, child ? null : dragBucket, { disabled: Boolean(portions?.draft) });
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
  return <div ref={drag.ref} {...drag.handlers} className={['health-row-line', unsettled && confirmation !== 'saved' && 'health-row-line--unsettled', child && 'health-row-line--child', lastChild && 'health-row-line--last-child', isGroup && 'health-row-line--group', added && 'health-row-line--added', reconstructed && 'health-row-line--reconstructed', drag.draggable && 'health-row-line--draggable', drag.dragging && 'health-row-line--dragging'].filter(Boolean).join(' ')} data-preview={preview.opened ? 'open' : undefined} data-entry-key={entryKey}>
    <div className="health-row__branch">
      {isGroup ? <UnstyledButton className="health-row__expand" aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} onClick={onToggle}
        // A draft may be sitting on one of this dish's members, with its error
        // and Discard on that member's row; collapsing would hide both while
        // the draft still locks the day.
        disabled={Boolean(portions?.draft)}><svg className="health-row__triangle" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d={expanded ? 'M0 0H10L5 10Z' : 'M0 0L10 5L0 10Z'} fill="currentColor" />
        </svg></UnstyledButton> : null}
    </div>
    <div className={`health-row-identity health-row__identity health-row__visual health-density-${densityPlacement}`}>
      {densityPlacement === 'before' ? <DensityBadge row={densityRow} editRow={row} /> : null}
      <span className="health-row-artwork" {...preview.targetProps} onClick={preview.onArtworkClick}>{row.photoRef && brokenPhoto !== row.photoRef ? <img className="health-row__thumb"
        src={nutritionPhotoUrl(row.photoRef, { thumb: true })} alt="" loading="lazy" onError={() => { setBrokenPhoto(row.photoRef); reportArtworkFailure('photo', row.photoRef, { uuid: entryId(row), name, icon: row.icon || null }); }} /> : <FoodIcon icon={row.icon} />}</span>
      <UnstyledButton className="health-row-name" disabled={Boolean(portions?.draft)} onClick={() => { preview.close(); onTap(row); }} aria-label={`Edit ${name}`}
        {...preview.targetProps} {...preview.focusProps}>
      <span className="health-row__description"><span className="health-row__name">{name}</span>{' '}
        {measured ? <span className="health-row__scale" title={measured}> · Scale ✓</span> : null}
        {reconstructed ? <span className="health-row__estimate" title="Estimated from weight change, resting metabolism, steps and workouts. Not logged food."> · weight-derived estimate</span> : null}
      </span>
      </UnstyledButton>
      {densityPlacement === 'after' ? <DensityBadge row={densityRow} editRow={row} /> : null}
    </div>
    <MacroBadges rows={isGroup ? row.children : [row]} editRow={row} className="health-row__macros health-row__visual" />
    <span className="health-row__portion-cell health-row__visual"><PortionControl row={row} /></span>
    <PortionControl row={row} field="calories" className="health-row__kcal health-row__visual">{displayKcal == null ? '—' : Math.round(displayKcal)}<small> kcal</small>
      {kcalShare == null ? null : <span className="health-row__kcal-bar" aria-hidden="true" style={{ '--kcal-share': kcalShare }} />}</PortionControl>
    <div className="health-row__action health-row__visual">
      {confirmation === 'saved' ? <span role="status" aria-label={`${name} confirmed`} title="Confirmed">✓</span> : unsettled ?
        <UnstyledButton className="health-row__confirm" aria-label={`Confirm entry: ${name}`} title="Confirm this estimate"
          disabled={confirmation === 'saving' || Boolean(portions?.draft)} aria-busy={confirmation === 'saving'} onClick={confirm}>{confirmation === 'saving' ? '…' : '✓'}</UnstyledButton> : null}
      {/* Asks the VIEW to delete rather than deleting: one dialog for the whole
          list, and the row never has to know what cascades. Muted until reached,
          because a destructive control that shouts on every row of a log you scan
          for numbers is the wrong kind of visible. Held back while a portion drag
          is live for the same reason the confirm is — a pointer already committed
          to one gesture must not land on another.

          NOT ON CHILD ROWS. A dish's members are deleted with the dish; giving
          each one its own X puts four more destructive controls inside one
          expanded group and makes the list harder to read than the mis-parse it
          would fix. An ingredient gets the gentler control below instead:
          it leaves the dish and stays in the meal, where its own X can delete it. */}
      {onRequestDelete && !child ? <UnstyledButton className="health-row__delete" aria-label={`Delete entry: ${name}`} title="Delete this entry"
        disabled={Boolean(portions?.draft)} onClick={() => onRequestDelete(row)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </UnstyledButton> : null}
      {onRemoveFromDish && child ? <UnstyledButton className="health-row__unnest" aria-label={`Take ${name} out of ${dishName || 'the dish'}`}
        title="Take out of the dish (stays in this meal)" disabled={dishBusy || Boolean(portions?.draft)} onClick={() => onRemoveFromDish(row)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
          <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </UnstyledButton> : null}
    </div>
    {error ? <span role="alert" className="health-row__error">{error}</span> : null}
    {portionAlertFor(portions, row) ? <PortionDraftAlert control={portions} className="health-portion-error health-portion-error--row" /> : null}
  </div>;
}
export default EntryRow;
