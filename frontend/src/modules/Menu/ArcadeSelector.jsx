import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { DaylightMediaPath, ContentDisplayUrl } from "../../lib/api.mjs";
import MenuNavigationContext from "../../context/MenuNavigationContext";
import getLogger from "../../lib/logging/Logger.js";
import "./ArcadeSelector.scss";

/**
 * ArcadeSelector: Hero-style game selector with large boxart on the left
 * and a tile navmap on the right.
 *
 * Rendered by TVMenu when menuMeta.menuStyle === 'arcade'.
 */

export function ArcadeSelector({
  items = [],
  depth,
  selectedIndex: selectedIndexProp = 0,
  selectedKey: selectedKeyProp = null,
  onSelectedIndexChange,
  onSelect,
  onClose,
}) {
  const logger = useMemo(() => getLogger().child({ component: "arcade-selector" }), []);
  const heroArtRef = useRef(null);
  const navmapRef = useRef(null);
  const rootRef = useRef(null);
  const prevSelectedRef = useRef(selectedIndexProp);
  const [columns, setColumns] = useState([]); // variable-width column layout

  // --- Triple-mode selection state (copied from MenuItems) ---
  const navContext = useContext(MenuNavigationContext);
  const useContextMode = depth !== undefined && navContext !== null;

  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0);
  const [internalSelectedKey, setInternalSelectedKey] = useState(null);
  const isControlled = onSelectedIndexChange !== undefined;

  let selectedIndex, currentKey;
  if (useContextMode) {
    const selection = navContext.getSelection(depth);
    selectedIndex = selection.index;
    currentKey = selection.key;
  } else if (isControlled) {
    selectedIndex = selectedIndexProp;
    currentKey = selectedKeyProp;
  } else {
    selectedIndex = internalSelectedIndex;
    currentKey = internalSelectedKey;
  }

  const findKeyForItem = useCallback((item) => {
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    return item?.id ?? item?.key ?? actionVal ?? item?.label ?? null;
  }, []);

  const setSelectedIndex = useCallback((value, key = null) => {
    const resolve = (v) => (typeof v === "function" ? v(selectedIndex) : v);
    const nextIndex = resolve(value);
    const nextKey = key ?? null;

    if (useContextMode) {
      navContext.setSelectionAtDepth(depth, nextIndex, nextKey);
    } else if (isControlled) {
      if (nextIndex === selectedIndexProp && nextKey === selectedKeyProp) return;
      onSelectedIndexChange(nextIndex, nextKey);
    } else {
      if (nextIndex === internalSelectedIndex && nextKey === internalSelectedKey) return;
      setInternalSelectedIndex(nextIndex);
      setInternalSelectedKey(nextKey);
    }
  }, [useContextMode, navContext, depth, isControlled, selectedIndex, selectedIndexProp, selectedKeyProp, internalSelectedIndex, internalSelectedKey, onSelectedIndexChange]);

  const handleClose = useCallback(() => {
    if (useContextMode) {
      navContext.pop();
    } else {
      onClose?.();
    }
  }, [useContextMode, navContext, onClose]);

  // --- Image resolution (copied from MenuItems) ---
  const resolveImage = useCallback((item) => {
    const actionObj = item?.play || item?.queue || item?.list || item?.open || {};
    const { contentId: itemContentId, plex } = actionObj;
    let image = item.image;

    if (image && (image.startsWith("/media/img/") || image.startsWith("media/img/"))) {
      image = DaylightMediaPath(image);
    }

    if (!image && (itemContentId || plex)) {
      const displayId = itemContentId || plex;
      const val = Array.isArray(displayId) ? displayId[0] : displayId;
      image = ContentDisplayUrl(val);
    }

    return image;
  }, []);

  // --- Build grid position lookup from columns layout ---
  const gridPos = useMemo(() => {
    if (!columns.length) return null;
    const map = {};
    columns.forEach((col, colIdx) => {
      col.items.forEach((itemIdx, row) => {
        map[itemIdx] = { col: colIdx, row };
      });
    });
    return map;
  }, [columns]);

  // --- Keyboard navigation (spatial grid) ---
  const handleKeyDown = useCallback(
    (e) => {
      if (!items.length) return;

      const navigate = (next) => {
        setSelectedIndex(next, findKeyForItem(items[next]));
      };

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (gridPos && gridPos[selectedIndex]) {
            const { col, row } = gridPos[selectedIndex];
            const colItems = columns[col].items;
            const nextRow = (row - 1 + colItems.length) % colItems.length;
            navigate(colItems[nextRow]);
          } else {
            navigate((selectedIndex - 1 + items.length) % items.length);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (gridPos && gridPos[selectedIndex]) {
            const { col, row } = gridPos[selectedIndex];
            const colItems = columns[col].items;
            const nextRow = (row + 1) % colItems.length;
            navigate(colItems[nextRow]);
          } else {
            navigate((selectedIndex + 1) % items.length);
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (gridPos && gridPos[selectedIndex]) {
            const { col, row } = gridPos[selectedIndex];
            const prevColIdx = (col - 1 + columns.length) % columns.length;
            const prevCol = columns[prevColIdx].items;
            const targetRow = Math.min(row, prevCol.length - 1);
            navigate(prevCol[targetRow]);
          } else {
            handleClose();
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (gridPos && gridPos[selectedIndex]) {
            const { col, row } = gridPos[selectedIndex];
            const nextColIdx = (col + 1) % columns.length;
            const nextCol = columns[nextColIdx].items;
            const targetRow = Math.min(row, nextCol.length - 1);
            navigate(nextCol[targetRow]);
          }
          break;

        case "Enter":
          e.preventDefault();
          onSelect?.(items[selectedIndex]);
          logger.info("item-selected", {
            contentId: findKeyForItem(items[selectedIndex]),
            title: items[selectedIndex]?.label,
          });
          break;

        case "Escape":
          e.preventDefault();
          handleClose();
          break;

        default:
          break;
      }
    },
    [items, selectedIndex, columns, gridPos, onSelect, handleClose, setSelectedIndex, findKeyForItem, logger]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // --- Selection restoration on items change ---
  useEffect(() => {
    if (!items.length) return;

    const matchIndex = currentKey
      ? items.findIndex((item) => findKeyForItem(item) === currentKey)
      : -1;

    if (matchIndex >= 0) {
      if (matchIndex !== selectedIndex || currentKey !== findKeyForItem(items[matchIndex])) {
        setSelectedIndex(matchIndex, currentKey);
      }
      return;
    }

    if (selectedIndex >= items.length) {
      const clamped = Math.max(0, items.length - 1);
      const key = findKeyForItem(items[clamped]);
      if (clamped !== selectedIndex || key !== currentKey) {
        setSelectedIndex(clamped, key);
      }
    } else {
      const key = findKeyForItem(items[selectedIndex]);
      if (key !== currentKey) {
        setSelectedIndex(selectedIndex, key);
      }
    }
  }, [items, selectedIndex, currentKey, setSelectedIndex, findKeyForItem]);

  // --- Web Animations API transition on selection change ---
  useEffect(() => {
    if (prevSelectedRef.current !== selectedIndex) {
      logger.debug("selection-changed", {
        from: prevSelectedRef.current,
        to: selectedIndex,
        gameTitle: items[selectedIndex]?.label,
      });

      heroArtRef.current?.animate(
        [
          { opacity: 0.6, transform: "scale(0.97)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 150, easing: "ease-out" }
      );

      prevSelectedRef.current = selectedIndex;
    }
  }, [selectedIndex, items, logger]);

  // --- Lifecycle logging ---
  useEffect(() => {
    logger.info("mounted", { itemCount: items.length });
    return () => logger.debug("unmounted");
  }, [logger, items.length]);

  // --- Navmap layout: greedy balanced partition ---
  // Assigns items to columns to equalize ratio sums (and thus widths).
  // Sorts items largest-ratio-first, deals each to the column with
  // the smallest current ratio sum.
  const itemRatios = useMemo(() =>
    items.map(item => item.thumbRatio || item.metadata?.thumbRatio || 0.75),
    [items]
  );

  useEffect(() => {
    const nav = navmapRef.current;
    if (!nav || !items.length) return;
    const H = nav.clientHeight;
    const W = nav.clientWidth;
    const N = items.length;
    const BORDER = 4;
    const MIN_PER_COL = 2;

    // Sort item indices by ratio descending (largest first for greedy)
    const sorted = items.map((_, i) => i);
    sorted.sort((a, b) => itemRatios[b] - itemRatios[a]);

    // Try each column count, pick the one with best fill
    let bestLayout = null;
    let bestScore = -1;
    const maxK = Math.min(Math.floor(N / MIN_PER_COL), Math.floor(W / 40));

    for (let k = 1; k <= maxK; k++) {
      // Greedy balanced partition: assign each item to column with smallest ratio sum
      const colSums = new Array(k).fill(0);
      const colItems = Array.from({ length: k }, () => []);

      for (const idx of sorted) {
        // Find column with smallest ratio sum
        let minCol = 0;
        for (let c = 1; c < k; c++) {
          if (colSums[c] < colSums[minCol]) minCol = c;
        }
        colItems[minCol].push(idx);
        colSums[minCol] += itemRatios[idx];
      }

      // Skip if any column has fewer than MIN_PER_COL items
      if (colItems.some(c => c.length < MIN_PER_COL)) continue;

      // Compute per-column widths
      const widths = colSums.map((sum, ci) => {
        const count = colItems[ci].length;
        return sum > 0 ? (H - BORDER * count) / sum : 0;
      });
      if (widths.some(w => w < 20)) continue;

      const totalW = widths.reduce((s, w) => s + w, 0);
      const scale = Math.min(1, W / totalW);
      const fill = scale < 1 ? scale : totalW / W;

      // Width uniformity
      const avgW = totalW / k;
      const variance = widths.reduce((s, w) => s + (w - avgW) ** 2, 0) / k;
      const uniformity = 1 / (1 + variance / (avgW * avgW));
      const score = fill * uniformity;

      if (score > bestScore) {
        bestScore = score;
        bestLayout = { colItems, widths, scale };
      }
    }

    if (bestLayout) {
      setColumns(bestLayout.colItems.map((itemIndices, ci) => ({
        width: Math.floor(bestLayout.widths[ci] * bestLayout.scale),
        items: itemIndices
      })));
    }
  }, [items.length, itemRatios]);

  const currentItem = items[selectedIndex] || {};
  const heroImage = resolveImage(currentItem);

  if (!items.length) return null;

  return (
    <div className="arcade-selector" ref={rootRef}>
      {/* LEFT: Hero panel */}
      <div className="arcade-selector__hero">
        <div className="arcade-selector__hero-art" ref={heroArtRef}>
          {heroImage && (
            <>
              <img className="arcade-selector__hero-bg" src={heroImage} alt="" aria-hidden="true" />
              <img className="arcade-selector__hero-img" src={heroImage} alt={currentItem.label} />
            </>
          )}
        </div>
        <div className="arcade-selector__hero-info">
          <h1 className="arcade-selector__title">{currentItem.label}</h1>
          {currentItem.parentTitle && (
            <p className="arcade-selector__console">{currentItem.parentTitle}</p>
          )}
        </div>
      </div>

      {/* RIGHT: Navmap tiles — variable-width columns */}
      <div
        className="arcade-selector__navmap"
        ref={navmapRef}
        style={{ visibility: columns.length ? 'visible' : 'hidden' }}
      >
        {columns.map((col, colIdx) => (
          <div
            key={colIdx}
            className="arcade-selector__navmap-col"
            style={{ width: `${col.width}px` }}
          >
            {col.items.map(index => {
              const ratio = itemRatios[index];
              // Deterministic random hue from item index for placeholder color
              const hue = (index * 137.508) % 360;
              return (
                <div
                  key={index}
                  className={`arcade-selector__navmap-item ${index === selectedIndex ? "active" : ""}`}
                  style={{
                    aspectRatio: `1 / ${ratio}`,
                    backgroundColor: `hsl(${hue}, 40%, 20%)`,
                  }}
                >
                  {resolveImage(items[index]) ? (
                    <img
                      src={resolveImage(items[index])}
                      alt={items[index].label}
                      width={col.width}
                      height={Math.round(col.width * ratio)}
                    />
                  ) : (
                    <span className="arcade-selector__navmap-placeholder" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
