import { useRef, useState } from 'react';
import { Button, Group, NumberInput, Popover, UnstyledButton } from '@mantine/core';
import { foodPortion, formatFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { numericFoodValue, numericFoodPatches } from '@shared-contracts/health/foodNumericEdit.mjs';
import { usePortionControl } from './usePortionDraft.js';
import { entryId } from './entryCommands.js';
import { useDismissLayer } from '../../../lib/ui/dismiss/useDismissLayer.js';

export function PortionControl({ row, field = 'portion', children, className }) {
  const control = usePortionControl();
  const gesture = useRef(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const portion = field === 'portion' ? foodPortion(row) : { value: numericFoodValue(row, field), unit: field === 'density' ? 'kcal/g' : field === 'calories' ? 'kcal' : 'g' };
  const wholeGrams = field === 'portion' && portion.unit === 'g';
  const decimals = field === 'density' ? 2 : wholeGrams || field === 'calories' ? 0 : 1;
  const minimum = field === 'portion' ? (wholeGrams ? 1 : 0.1) : field === 'calories' ? 1 : 0;
  const step = field === 'density' ? 0.01 : 1;
  const normalize = next => Math.max(minimum, Number(next.toFixed(decimals)));
  const display = children ?? formatFoodPortion(row);
  const classes = className ?? 'health-row__portion health-portion';
  const name = row.name || row.item || row.label;
  const own = control?.draft && entryId(control.draft.row) === entryId(row) && (control.draft.numericEdit?.field ?? 'portion') === field;
  const cancel = () => { gesture.current = null; setOpen(false); control?.cancel(); };
  useDismissLayer(open || Boolean(own), cancel);
  let unavailable = portion.value === null ? `Edit ${name} to enter an exact ${field} value first` : null;
  if (field !== 'portion' && !unavailable) {
    const baseline = own ? control.draft.row : row;
    try { numericFoodPatches(baseline, { field, value: numericFoodValue(baseline, field) }); } catch (error) { unavailable = error.message; }
  }
  if (!control || unavailable) return <span className={classes} title={unavailable || undefined}>{display}</span>;
  const begin = () => control.begin(row, field);
  const validInput = typeof value === 'number' && value >= minimum && !control.draft?.validationError;
  const submit = () => { if (!control.draft?.validationError) { setOpen(false); control.commit(); } };
  return <Popover opened={open} onChange={opened => { if (!opened) cancel(); }} position="bottom" withArrow>
    <Popover.Target><UnstyledButton className={`${classes} health-numeric-control`} disabled={control.locked || Boolean(control.draft && !own)}
      aria-label={`Adjust ${field} of ${name}, ${portion.value} ${portion.unit}`} title={`Drag left or right, or click to enter ${field}`}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false || !begin()) return;
        gesture.current = { x: event.clientX, value: portion.value, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
        const start = gesture.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (!start.moved && Math.abs(dx) < 5) return;
        start.moved = true;
        control.preview(normalize(start.value + dx / 2 * step * (event.shiftKey ? 0.1 : 1)));
      }}
      onPointerUp={event => {
        const start = gesture.current;
        if (!start) return;
        gesture.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (start.moved) submit();
        else { setValue(wholeGrams ? Math.round(portion.value) : portion.value); setOpen(true); }
      }}
      onPointerCancel={cancel}
      onClick={event => {
        // Assistive technology can activate a button without pointer events.
        if (event.detail === 0 && !own && !open && begin()) { setValue(normalize(portion.value)); setOpen(true); }
      }}
      onLostPointerCapture={() => { if (gesture.current) cancel(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          if (!own && !begin()) return;
          control.preview(normalize(portion.value + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1) * step * (event.shiftKey && !wholeGrams ? 0.1 : 1)));
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (own) submit();
          else if (begin()) { setValue(normalize(portion.value)); setOpen(true); }
        }
      }}>{display}</UnstyledButton></Popover.Target>
    <Popover.Dropdown><NumberInput autoFocus label={`${field === 'portion' ? 'Portion' : field} (${portion.unit})`} value={value} min={minimum} decimalScale={decimals}
      onChange={next => { setValue(next); if (typeof next === 'number') control.preview(next); }}
      onKeyDown={event => { if (event.key === 'Escape') cancel(); if (event.key === 'Enter' && validInput) submit(); }} />
      <Group gap="xs"><Button variant="subtle" onClick={cancel}>Cancel</Button>
        <Button disabled={!validInput} onClick={submit}>Apply</Button></Group>
    </Popover.Dropdown>
  </Popover>;
}
