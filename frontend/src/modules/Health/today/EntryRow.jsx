import { UnstyledButton } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { nutritionPhotoUrl } from './photoUrl.js';

const logger = createAppLogger('health').child('entry-row');

// A failed thumbnail load hides itself in place — no broken-image glyph,
// no layout jump. Direct DOM mutation (not React state) because the
// element's own 32px grid column is reserved unconditionally by
// `photoRef`'s presence, not by load success — hiding the <img> alone
// leaves that column's width intact, so nothing around it reflows.
const hideBrokenThumb = (e) => { e.currentTarget.style.display = 'none'; };

const NOOM = { green: 'var(--ds-success)', yellow: 'var(--ds-warning)', orange: 'var(--ds-danger)' };

/**
 * `row` renders as an item by default. Pass `isGroup` to render it as a
 * group header (rollup kcal instead of the row's own — zero, by design —
 * calories, plus an expand/collapse control) and `child` to render it as
 * one of that group's indented children. Both presentations keep the
 * unsettled cue and confirm affordance exactly as a plain item does.
 */
export function EntryRow({ row, onTap, onConfirm, isGroup = false, expanded = false, onToggle, rollupKcal, child = false, measured = null }) {
  const portion = [row.amount, row.unit].filter(Boolean).join(' ') || (row.grams ? `${row.grams} g` : '');
  // The API serves an EFFECTIVE settled flag per row. Absent or `true` means
  // settled — only an explicit `false` means unsettled. Never treat a
  // missing key as unsettled (older/other row shapes lack the field).
  const unsettled = row.settled === false;
  const name = row.name || row.item || row.label || '';
  const displayKcal = isGroup ? rollupKcal : row.calories;

  const confirm = async (e) => {
    e.stopPropagation();
    try {
      await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { settled: true }, 'PUT');
      logger.info('entry.confirm', { uuid: row.uuid });
      onConfirm?.(row);
    } catch (err) {
      logger.error('entry.confirm_failed', { uuid: row.uuid, error: err?.message });
    }
  };

  const toggle = (e) => {
    e.stopPropagation();
    onToggle?.();
  };

  const lineClass = [
    'health-row-line',
    unsettled && 'health-row-line--unsettled',
    child && 'health-row-line--child',
  ].filter(Boolean).join(' ');

  const hasThumb = Boolean(row.photoRef);

  const rowClass = [
    'health-row',
    unsettled && 'health-row--unsettled',
    isGroup && 'health-row--group',
    child && 'health-row--child',
    hasThumb && 'health-row--thumb',
  ].filter(Boolean).join(' ');

  return (
    <div className={lineClass}>
      {isGroup ? (
        // Sibling button, never nested inside the row button below (a
        // button-in-a-button is invalid and would swallow the row tap).
        // `aria-expanded` plus the Expand/Collapse text in the accessible
        // name make the state perceivable non-visually — never chevron
        // rotation alone.
        <UnstyledButton
          className="health-row__expand"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
          onClick={toggle}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </UnstyledButton>
      ) : null}
      <UnstyledButton className={rowClass} onClick={() => onTap(row)}>
        {hasThumb ? (
          <img
            className="health-row__thumb"
            src={nutritionPhotoUrl(row.photoRef, { thumb: true })}
            alt=""
            loading="lazy"
            onError={hideBrokenThumb}
          />
        ) : null}
        {!isGroup ? (
          <span className="health-row__dot" style={{ background: NOOM[row.color] || 'var(--ds-text-low)' }} />
        ) : null}
        <span className="health-row__name">{name}</span>
        <span className="health-row__portion">{portion}</span>
        <span className="health-row__kcal">{Math.round(displayKcal || 0)}</span>
        {/* Text badge, not color alone — perceivable non-visually and in
            greyscale. Static text; no aria-live, so it never spams. */}
        {unsettled ? <span className="health-row__badge">Unconfirmed</span> : null}
        {/* SCALE-MEASURED badge: this row's grams came off the kitchen scale, not
            from a guess. `measured` is the caller's already-computed summary
            ("82 g · scale ✓") — derived once per day from the observations that
            name this row's uuid, never re-derived per row. Text, like the
            unsettled badge above, so it survives greyscale and a screen reader. */}
        {measured ? <span className="health-row__scale">{measured}</span> : null}
      </UnstyledButton>
      {unsettled ? (
        <UnstyledButton className="health-row__confirm" aria-label="Confirm entry" onClick={confirm}>
          <span aria-hidden="true">✓</span>
        </UnstyledButton>
      ) : null}
    </div>
  );
}
export default EntryRow;
