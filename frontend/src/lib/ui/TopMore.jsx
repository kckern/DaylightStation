// Show the few that matter, then More (design-system.md, "Long lists").
//
// `TopMoreList` renders a list's top part (splitTopMore) and one "More (k)"
// that expands the rest in place; `TopMoreMenu` does the same inside a Mantine
// Menu (Mantine 7 has no nested submenu, so More opens the rest in the same
// dropdown, below a divider). Either way:
//   - the active/current/selected ids (`keepIds`) are always shown;
//   - Enter or Space on More expands it (it is a real button / menu item) and
//     focus moves to the first newly shown item;
//   - once expanded it stays expanded until the surface closes (unmounts).
// The caller renders the rows; these only decide which ones and own More.
import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Menu } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { splitTopMore } from './splitTopMore.js';
import './TopMore.scss';

const FOCUSABLE = [
  'button:not([disabled])', '[href]', 'input:not([disabled])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])', '[role="menuitem"]:not([data-disabled])',
].join(', ');

const defaultLabel = (count) => `More (${count})`;

/**
 * Expansion state plus the focus hand-off: `expand(fromElement)` notes what
 * was focusable around More before, and after the rest renders focuses the
 * first element that was not there.
 */
function useTopMoreExpansion(onExpand, counts) {
  const [expanded, setExpanded] = useState(false);
  const pending = useRef(null);
  useLayoutEffect(() => {
    const visit = pending.current;
    if (!visit || !expanded) return;
    pending.current = null;
    const next = [...visit.scope.querySelectorAll(FOCUSABLE)].find((element) => !visit.seen.has(element));
    next?.focus({ preventScroll: false });
  });
  const expand = (fromElement) => {
    if (expanded) return;
    const scope = fromElement?.parentElement?.closest?.('[role="menu"]') ?? fromElement?.parentElement ?? null;
    if (scope) pending.current = { scope, seen: new Set(scope.querySelectorAll(FOCUSABLE)) };
    setExpanded(true);
    onExpand?.(counts);
  };
  return { expanded, expand };
}

/**
 * splitTopMore, plus: a row once shown stays shown while the surface is open,
 * so a row never vanishes under the pointer when it is unticked or when the
 * ranking shifts (a screen starts playing elsewhere).
 */
function useStickySplit(items, { n, rank, keepIds, getId = (item) => item?.id, canTop, stable = true }) {
  const shownIds = useRef(new Set());
  const sticky = stable ? [...shownIds.current] : [];
  const split = splitTopMore(items, { n, rank, keepIds: [...(keepIds ?? []), ...sticky], getId, canTop });
  if (stable) for (const item of split.top) shownIds.current.add(getId(item));
  return split;
}

/**
 * @param {object} props
 * @param {any[]} props.items
 * @param {number} props.n                     how many to show before More
 * @param {(a, b) => number} [props.rank]
 * @param {Iterable<string>} [props.keepIds]   always shown (active, current, selected)
 * @param {(item) => string} [props.getId]
 * @param {(item) => boolean} [props.canTop]   false sends an item under More
 * @param {(item, index: number) => React.ReactNode} props.renderItem
 * @param {(count: number) => string} [props.moreLabel]  "More (k)" by default
 * @param {'li'|null} [props.moreAs]           wrap More in an <li> inside a <ul>
 * @param {({ shown: number, hidden: number }) => void} [props.onExpand]
 * @param {string} [props.testId]
 * @param {boolean} [props.stable]   a row once shown stays shown (default); a
 *   queue, whose window moves with what plays, passes false
 * @param {'top-first'|'input'} [props.expandedOrder]  expanded, show the top
 *   part then the rest (default, nothing seen moves), or every item in input
 *   order (a queue keeps its play order)
 */
export function TopMoreList({
  items, n, rank = null, keepIds = [], getId, canTop = null, renderItem,
  moreLabel = defaultLabel, moreAs = null, onExpand = null, testId = 'top-more', moreClassName = '',
  stable = true, expandedOrder = 'top-first',
}) {
  const { top, more } = useStickySplit(items, { n, rank, keepIds, getId, canTop, stable });
  const { expanded, expand } = useTopMoreExpansion(onExpand, { shown: top.length, hidden: more.length });
  const all = expandedOrder === 'input' ? (Array.isArray(items) ? items : []) : [...top, ...more];
  const shown = expanded ? all : top;
  const control = !expanded && more.length > 0 ? (
    <Button
      variant="subtle"
      color="gray"
      size="compact-sm"
      className={`ds-top-more ${moreClassName}`.trim()}
      data-testid={`${testId}-more`}
      aria-expanded={false}
      rightSection={<IconChevronDown size={14} aria-hidden />}
      onClick={(event) => expand(moreAs === 'li' ? event.currentTarget.parentElement : event.currentTarget)}
    >
      {moreLabel(more.length)}
    </Button>
  ) : null;
  return (
    <>
      {shown.map((item, index) => renderItem(item, index))}
      {control && (moreAs === 'li' ? <li className="ds-top-more-row">{control}</li> : control)}
    </>
  );
}

/**
 * The same inside a Mantine Menu dropdown: render it among Menu.Items.
 * `renderItem` returns a Menu.Item.
 */
export function TopMoreMenu({
  items, n, rank = null, keepIds = [], getId, canTop = null, renderItem,
  moreLabel = defaultLabel, onExpand = null, testId = 'top-more', divider = true,
}) {
  const { top, more } = useStickySplit(items, { n, rank, keepIds, getId, canTop });
  const { expanded, expand } = useTopMoreExpansion(onExpand, { shown: top.length, hidden: more.length });
  return (
    <>
      {top.map((item, index) => renderItem(item, index))}
      {expanded && more.length > 0 && divider && <Menu.Divider />}
      {expanded && more.map((item, index) => renderItem(item, top.length + index))}
      {!expanded && more.length > 0 && (
        <Menu.Item
          data-testid={`${testId}-more`}
          className="ds-top-more"
          closeMenuOnClick={false}
          aria-expanded={false}
          rightSection={<IconChevronDown size={14} aria-hidden />}
          onClick={(event) => { event.stopPropagation?.(); expand(event.currentTarget); }}
        >
          {moreLabel(more.length)}
        </Menu.Item>
      )}
    </>
  );
}

export default TopMoreList;
