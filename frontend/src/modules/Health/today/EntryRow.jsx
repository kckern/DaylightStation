import { useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { nutritionPhotoUrl } from './photoUrl.js';
import { FoodIcon } from './FoodIcon.jsx';

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
  // Which SLUG failed, not a boolean: the row's icon can change under a live
  // component (the edit sheet's override rewrites it and the day reloads in
  // place), and a boolean would keep hiding the new picture because the old
  // one broke. No reset effect either — that is a race, and there is nothing
  // to reset when the state names what it is about.
  const [error, setError] = useState(null);
  // Grams are the one comparable quantity across captures. `amount + unit`
  // is model prose (cup, tbsp, serving) and has produced nonsense such as
  // "313 servings" when amount was actually the gram count. Show a valid
  // mass in grams, or show nothing — never expose that mixed vocabulary.
  const grams = Number(row.grams);
  const portion = Number.isFinite(grams) && grams > 0 ? `${Math.round(grams * 10) / 10} g` : isGroup ? '' : 'Weight unknown';
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
      setError(err);
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

  // A dish's own picture, else the first thing in it (PRD F5.3). A group row
  // is handed its children by LogTable precisely so this can be decided here
  // rather than at every call site.
  const iconSlug = row.icon || (isGroup ? row.children?.find((c) => c.icon)?.icon : null) || null;

  const rowClass = [
    'health-row',
    unsettled && 'health-row--unsettled',
    isGroup && 'health-row--group',
    child && 'health-row--child',
    hasThumb && 'health-row--thumb',
    // The icon occupies the dot's grid column at a larger size, so the column
    // width is a function of which of the two is actually rendered.
    'health-row--icon',
  ].filter(Boolean).join(' ');

  return (
    <div className={lineClass}>
      {error ? <span role="alert" className="health-capture-error">{error.message}</span> : null}
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
        {/* The food's picture where there is one, the Noom dot where there is
            not. The dot remains the fallback glyph (PRD F5.3): a group row
            has no dot of its own, so a group whose icon fails simply loses
            the column — the same shape it had before icons existed.
            `onError` names the slug it is retiring, so a later override of
            the same row shows its new picture immediately. */}
        <FoodIcon icon={iconSlug} />
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
