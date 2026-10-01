import { useMemo, useRef, useState } from 'react';
import { Menu, UnstyledButton } from '@mantine/core';
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
import { RowRevise } from './RowRevise.jsx';

// A food row whose art is not settled yet: the artwork queue works every such
// row until it has a real icon (it never gives up), so the generic glyph here
// means "on its way". Dish headers are never queued, and an icon the person
// chose themselves is final.
const artworkPending = row => row.kind !== 'group' && !(row.manualFields || []).includes('icon');
import { isReconstructedRow } from '@shared-contracts/nutrition/reconstruction.mjs';

const logger = createAppLogger('health').child('entry-row');

// A tap anywhere on the row opens its details, except on a control that owns
// its own click (portion, kcal, macros, the menu, the dish triangle, the photo
// preview), and never from a click that bubbled up out of a portal (a menu or
// popover dropdown is a React child but not a DOM child of the row).
const OWN_CLICK = 'button, a, input, textarea, select, label, [role="menuitem"], [role="dialog"], .health-row-artwork, .health-row-revise';
const rowTapTarget = event => event.currentTarget.contains(event.target) && !event.target.closest(OWN_CLICK);

export function EntryRow({ row, densityRow = row, onTap, onConfirm, onRequestDelete, isGroup = false, expanded = false, onToggle, rollupKcal, child = false, lastChild = false, measured = null, kcalShare = null, added = false, entryKey = undefined, dragBucket = null, onChanged = null }) {
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [revising, setRevising] = useState(false);
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
  const openDetails = () => { if (portions?.draft) return; preview.close(); onTap(row); };
  return <><div ref={drag.ref} {...drag.handlers} onClick={event => { if (rowTapTarget(event)) openDetails(); }} className={['health-row-line', unsettled && confirmation !== 'saved' && 'health-row-line--unsettled', child && 'health-row-line--child', lastChild && 'health-row-line--last-child', isGroup && 'health-row-line--group', added && 'health-row-line--added', reconstructed && 'health-row-line--reconstructed', drag.draggable && 'health-row-line--draggable', drag.dragging && 'health-row-line--dragging'].filter(Boolean).join(' ')} data-preview={preview.opened ? 'open' : undefined} data-entry-key={entryKey}>
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
        src={nutritionPhotoUrl(row.photoRef, { thumb: true })} alt="" loading="lazy" onError={() => { setBrokenPhoto(row.photoRef); reportArtworkFailure('photo', row.photoRef, { uuid: entryId(row), name, icon: row.icon || null }); }} /> : <FoodIcon icon={row.icon} pending={artworkPending(row)} />}</span>
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
    {/* The row's one control. Every action that used to sit here as its own
        icon (confirm ✓, delete ✕, take out of dish −) lives in this menu, so a
        log scanned for numbers carries one quiet affordance per row. Remove
        deletes — on a dish part too; "take out but keep" read as a duplicate
        (2026-10-01). */}
    <div className="health-row__action health-row__visual">
      {confirmation === 'saved' ? <span className="health-row__verified" role="status" aria-label={`${name} verified`} title="Verified">✓</span> : null}
      <Menu position="bottom-end" withinPortal shadow="md" disabled={Boolean(portions?.draft)}>
        <Menu.Target>
          <UnstyledButton className="health-row__menu" aria-label={`Actions for ${name}`} title="Actions" disabled={Boolean(portions?.draft)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <circle cx="7" cy="2.5" r="1.4" fill="currentColor" /><circle cx="7" cy="7" r="1.4" fill="currentColor" /><circle cx="7" cy="11.5" r="1.4" fill="currentColor" />
            </svg>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => { logger.debug('row.menu', { action: 'details', uuid: entryId(row) }); openDetails(); }}>Details</Menu.Item>
          {unsettled && confirmation !== 'saved' ? <Menu.Item disabled={confirmation === 'saving'} onClick={() => { logger.debug('row.menu', { action: 'verify', uuid: entryId(row) }); confirm(); }}>Verify</Menu.Item> : null}
          <Menu.Item onClick={() => { logger.debug('row.menu', { action: 'revise', uuid: entryId(row) }); setRevising(true); }}>Revise</Menu.Item>
          {onRequestDelete ? <Menu.Item color="red" onClick={() => { logger.debug('row.menu', { action: 'remove', uuid: entryId(row) }); onRequestDelete(row); }}>Remove</Menu.Item> : null}
        </Menu.Dropdown>
      </Menu>
    </div>
    {error ? <span role="alert" className="health-row__error">{error}</span> : null}
    {portionAlertFor(portions, row) ? <PortionDraftAlert control={portions} className="health-portion-error health-portion-error--row" /> : null}
  </div>
  {revising ? <RowRevise row={row} isGroup={isGroup} onClose={() => setRevising(false)}
    onChanged={result => { onChanged ? onChanged(result) : onConfirm?.(row); }} onReload={() => onConfirm?.(row)} /> : null}
  </>;
}
export default EntryRow;
