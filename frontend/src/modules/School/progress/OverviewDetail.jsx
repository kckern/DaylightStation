import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Subject-neutral overview/focus/inspector interaction primitive.
 *
 * The overview keeps the whole set visible while one movable focus exposes
 * detail in a stable inspector. Arrow navigation follows the visual grid;
 * Home/End jump to its bounds. Consumers supply semantics and rendering.
 */
export default function OverviewDetail({
  items = [],
  ariaLabel,
  columns = 4,
  selectedKey,
  onSelectionChange,
  renderItem,
  renderInspector,
  className = '',
}) {
  const stableItems = useMemo(() => items.filter((item) => item?.key), [items]);
  const [localKey, setLocalKey] = useState(stableItems[0]?.key ?? null);
  const controlled = selectedKey !== undefined;
  const requestedKey = controlled ? selectedKey : localKey;
  const activeIndex = Math.max(0, stableItems.findIndex((item) => item.key === requestedKey));
  const active = stableItems[activeIndex] ?? null;
  const inspectorId = useId();
  const itemRefs = useRef(new Map());

  useEffect(() => {
    if (stableItems.length === 0) {
      if (!controlled) setLocalKey(null);
      return;
    }
    if (!stableItems.some((item) => item.key === requestedKey) && !controlled) {
      setLocalKey(stableItems[0].key);
    }
  }, [controlled, requestedKey, stableItems]);

  const select = (item, { focus = false } = {}) => {
    if (!item) return;
    if (!controlled) setLocalKey(item.key);
    onSelectionChange?.(item);
    if (focus) itemRefs.current.get(item.key)?.focus();
  };

  const move = (from, delta) => {
    const index = Math.max(0, Math.min(stableItems.length - 1, from + delta));
    select(stableItems[index], { focus: true });
  };

  const onKeyDown = (event, index) => {
    const columnCount = Math.max(1, Number(columns) || 1);
    const delta = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columnCount,
      ArrowDown: columnCount,
    }[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      move(index, delta);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      select(stableItems[event.key === 'Home' ? 0 : stableItems.length - 1], { focus: true });
    }
  };

  if (!active) return null;

  return (
    <div className={`school-overview-detail ${className}`.trim()}>
      <div id={inspectorId} className="school-overview-detail__inspector" aria-live="polite">
        {renderInspector(active)}
      </div>
      <div
        className="school-overview-detail__overview"
        role="grid"
        aria-label={ariaLabel}
        aria-describedby={inspectorId}
        style={{ '--school-overview-columns': Math.max(1, Number(columns) || 1) }}
      >
        {stableItems.map((item, index) => {
          const selected = item.key === active.key;
          return (
            <button
              key={item.key}
              ref={(element) => {
                if (element) itemRefs.current.set(item.key, element);
                else itemRefs.current.delete(item.key);
              }}
              type="button"
              role="gridcell"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              data-kind={item.kind ?? undefined}
              className={`school-overview-detail__item${selected ? ' is-selected' : ''}`}
              style={{ '--school-overview-depth': item.depth ?? 0 }}
              onClick={() => select(item)}
              onFocus={() => select(item)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {renderItem(item, { selected })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
