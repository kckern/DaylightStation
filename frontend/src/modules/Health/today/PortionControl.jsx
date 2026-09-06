import { useRef, useState } from 'react';
import { Button, Group, NumberInput, Popover, UnstyledButton } from '@mantine/core';
import { foodPortion, formatFoodPortion } from '@shared-contracts/health/foodQuantity.mjs';
import { usePortionControl } from './usePortionDraft.js';
import { entryId } from './entryCommands.js';
import { useDismissLayer } from '../../../lib/ui/dismiss/useDismissLayer.js';

export function PortionControl({ row }) {
  const control = usePortionControl();
  const gesture = useRef(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const portion = foodPortion(row);
  const wholeGrams = portion.unit === 'g';
  const normalize = next => wholeGrams ? Math.max(1, Math.round(next)) : Math.max(0.1, Math.round(next * 10) / 10);
  const name = row.name || row.item || row.label;
  const own = control?.draft && entryId(control.draft.row) === entryId(row);
  const cancel = () => { gesture.current = null; setOpen(false); control?.cancel(); };
  useDismissLayer(open || Boolean(own), cancel);
  if (!control || portion.value === null) return <span className="health-row__portion">{formatFoodPortion(row)}</span>;
  return <Popover opened={open} onChange={opened => { if (!opened) cancel(); }} position="bottom" withArrow>
    <Popover.Target><UnstyledButton className="health-row__portion health-portion" disabled={control.locked}
      aria-label={`Adjust portion of ${name}, ${formatFoodPortion(row)}`} title="Drag left or right, or click to enter a portion"
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false || !control.begin(row)) return;
        gesture.current = { x: event.clientX, value: portion.value, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
        const start = gesture.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (!start.moved && Math.abs(dx) < 5) return;
        start.moved = true;
        control.preview(normalize(start.value + dx / 2 * (event.shiftKey ? 0.1 : 1)));
      }}
      onPointerUp={event => {
        const start = gesture.current;
        if (!start) return;
        gesture.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (start.moved) control.commit();
        else { setValue(wholeGrams ? Math.round(portion.value) : portion.value); setOpen(true); }
      }}
      onPointerCancel={cancel}
      onClick={event => {
        // Assistive technology can activate a button without pointer events.
        if (event.detail === 0 && !own && !open && control.begin(row)) { setValue(wholeGrams ? Math.round(portion.value) : portion.value); setOpen(true); }
      }}
      onLostPointerCapture={() => { if (gesture.current) cancel(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          if (!own && !control.begin(row)) return;
          control.preview(normalize(portion.value + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1) * (event.shiftKey && !wholeGrams ? 0.1 : 1)));
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (own) control.commit();
          else if (control.begin(row)) { setValue(wholeGrams ? Math.round(portion.value) : portion.value); setOpen(true); }
        }
      }}>{formatFoodPortion(row)}</UnstyledButton></Popover.Target>
    <Popover.Dropdown><NumberInput autoFocus label={`Portion (${portion.unit})`} value={value} min={wholeGrams ? 1 : 0.1} decimalScale={wholeGrams ? 0 : 1}
      onChange={next => { setValue(next); if (typeof next === 'number') control.preview(next); }}
      onKeyDown={event => { if (event.key === 'Escape') cancel(); if (event.key === 'Enter' && value > 0) { setOpen(false); control.commit(); } }} />
      <Group gap="xs"><Button variant="subtle" onClick={cancel}>Cancel</Button>
        <Button disabled={!(value > 0)} onClick={() => { setOpen(false); control.commit(); }}>Apply</Button></Group>
    </Popover.Dropdown>
  </Popover>;
}
