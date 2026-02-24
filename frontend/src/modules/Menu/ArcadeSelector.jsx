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
  const didRandomInit = useRef(false);
  const [layout, setLayout] = useState([]); // tetris-style placements [{idx, x, y, w, h}]

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

  // --- Build spatial position lookup from layout ---
  const tilePos = useMemo(() => {
    if (!layout.length) return null;
    const map = {};
    layout.forEach(p => {
      map[p.idx] = { cx: p.x + p.w / 2, cy: p.y + p.h / 2 };
    });
    return map;
  }, [layout]);

  // --- Spatial nearest-neighbor for directional navigation ---
  const findNearest = useCallback((fromIdx, dir) => {
    if (!tilePos || !tilePos[fromIdx]) return -1;
    const from = tilePos[fromIdx];
    let best = -1, bestScore = Infinity;
    for (const p of layout) {
      if (p.idx === fromIdx) continue;
      const to = tilePos[p.idx];
      const dx = to.cx - from.cx;
      const dy = to.cy - from.cy;
      let valid, primary, secondary;
      switch (dir) {
        case 'right': valid = dx > 10; primary = dx; secondary = Math.abs(dy); break;
        case 'left':  valid = dx < -10; primary = -dx; secondary = Math.abs(dy); break;
        case 'down':  valid = dy > 10; primary = dy; secondary = Math.abs(dx); break;
        case 'up':    valid = dy < -10; primary = -dy; secondary = Math.abs(dx); break;
        default: return -1;
      }
      if (!valid) continue;
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = p.idx; }
    }
    return best;
  }, [layout, tilePos]);

  // --- Keyboard navigation (spatial nearest-neighbor) ---
  const handleKeyDown = useCallback(
    (e) => {
      if (!items.length) return;

      const navigate = (next) => {
        if (next >= 0) setSelectedIndex(next, findKeyForItem(items[next]));
      };

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          navigate(findNearest(selectedIndex, 'up'));
          break;

        case "ArrowDown":
          e.preventDefault();
          navigate(findNearest(selectedIndex, 'down'));
          break;

        case "ArrowLeft": {
          e.preventDefault();
          const next = findNearest(selectedIndex, 'left');
          if (next >= 0) navigate(next);
          else handleClose();
          break;
        }

        case "ArrowRight":
          e.preventDefault();
          navigate(findNearest(selectedIndex, 'right'));
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
    [items, selectedIndex, layout, tilePos, findNearest, onSelect, handleClose, setSelectedIndex, findKeyForItem, logger]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // --- Selection restoration on items change ---
  useEffect(() => {
    if (!items.length) return;

    // Random initial selection on first mount
    if (!didRandomInit.current) {
      didRandomInit.current = true;
      const randIdx = Math.floor(Math.random() * items.length);
      const key = findKeyForItem(items[randIdx]);
      logger.info("random-init", { index: randIdx, total: items.length, title: items[randIdx]?.label });
      setSelectedIndex(randIdx, key);
      return;
    }

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

  // --- Navmap layout: justified rows with area-conscious packing ---
  // Tiles are packed into rows where each row fills the container width exactly.
  // Different row counts are tried to find the best vertical fill.
  // Sorting by ratio (with jitter) groups similar-sized tiles together,
  // which minimizes area variance within rows.
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
    const GAP = 3;

    // Shuffle item indices for variety (Fisher-Yates)
    // With justified rows, order doesn't affect layout correctness —
    // mixing ratios across rows actually makes row heights more uniform.
    const sorted = items.map((_, i) => i);
    for (let i = sorted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    }

    // Try different reference heights to find the best vertical fill
    let bestPlacements = null;
    let bestScore = -Infinity;
    const maxRows = Math.min(Math.ceil(N / 2), Math.floor(H / 30));

    for (let targetRows = 2; targetRows <= maxRows; targetRows++) {
      const refH = (H - (targetRows - 1) * GAP) / targetRows;

      // Pack into rows greedily at reference height
      const rows = [];
      let row = [];
      let rowW = 0;
      for (const idx of sorted) {
        const tw = refH / itemRatios[idx];
        if (row.length > 0 && rowW + GAP + tw > W) {
          rows.push(row);
          row = [idx];
          rowW = tw;
        } else {
          rowW += (row.length > 0 ? GAP : 0) + tw;
          row.push(idx);
        }
      }
      if (row.length) rows.push(row);

      // Merge short last row into previous to prevent runaway sizes
      const MIN_PER_ROW = 3;
      while (rows.length > 1 && rows[rows.length - 1].length < MIN_PER_ROW) {
        const lastRow = rows.pop();
        rows[rows.length - 1].push(...lastRow);
      }

      // Compute justified row heights (each row fills W exactly)
      const rowData = rows.map(indices => {
        const gaps = (indices.length - 1) * GAP;
        const invRatioSum = indices.reduce((s, idx) => s + 1 / itemRatios[idx], 0);
        const rowH = (W - gaps) / invRatioSum;
        return { indices, rowH };
      });

      const totalH = rowData.reduce((s, r) => s + r.rowH, 0);
      const fillRatio = totalH / H;
      const score = fillRatio <= 1 ? fillRatio : 1 / fillRatio;

      if (score > bestScore) {
        bestScore = score;
        const placements = [];

        if (totalH > H) {
          // Overflow: scale uniformly, center rows horizontally
          const s = H / totalH;
          let y = 0;
          for (const { indices, rowH } of rowData) {
            const sh = rowH * s;
            const rowTotalW = indices.reduce((sum, idx) => sum + sh / itemRatios[idx], 0)
              + (indices.length - 1) * GAP;
            let x = (W - rowTotalW) / 2;
            for (const idx of indices) {
              const w = sh / itemRatios[idx];
              placements.push({ idx, x, y, w, h: sh });
              x += w + GAP;
            }
            y += sh;
          }
        } else {
          // Fits: extra space goes to top/bottom padding only
          const pad = (H - totalH) / 2;
          let y = pad;
          for (const { indices, rowH } of rowData) {
            let x = 0;
            for (const idx of indices) {
              const w = rowH / itemRatios[idx];
              placements.push({ idx, x, y, w, h: rowH });
              x += w + GAP;
            }
            y += rowH;
          }
        }
        bestPlacements = placements;
      }
    }

    if (bestPlacements) {
      // Random mirror/flip for variety
      const mirrorH = Math.random() < 0.5;
      const mirrorV = Math.random() < 0.5;
      if (mirrorH || mirrorV) {
        const extentW = bestPlacements.reduce((m, p) => Math.max(m, p.x + p.w), 0);
        const extentH = bestPlacements.reduce((m, p) => Math.max(m, p.y + p.h), 0);
        bestPlacements.forEach(p => {
          if (mirrorH) p.x = extentW - p.x - p.w;
          if (mirrorV) p.y = extentH - p.y - p.h;
        });
      }
      setLayout(bestPlacements);
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
          <h1 className="arcade-selector__title">
            {(() => {
              let label = currentItem.label || '';
              // Move trailing ", The" to front (e.g. "Legend of Zelda, The" → "The Legend of Zelda")
              label = label.replace(/^(.+),\s*(The|A|An)\b/i, '$2 $1');
              const match = label.match(/^(.+?)\s-\s(.+)$/) || label.match(/^(.+?:\s?)(.+)$/);
              if (!match) return label;
              const keepSep = !label.includes(' - '); // colon stays, dash hidden
              return <>
                {match[1]}{!keepSep && <span className="arcade-selector__title-sep"> - </span>}<br />
                <span className="arcade-selector__subtitle">{match[2]}</span>
              </>;
            })()}
          </h1>
          {currentItem.parentTitle && (
            <p className="arcade-selector__console">{currentItem.parentTitle}</p>
          )}
        </div>
      </div>

      {/* RIGHT: Navmap tiles — tetris-style packing */}
      <div
        className="arcade-selector__navmap"
        ref={navmapRef}
        style={{ visibility: layout.length ? 'visible' : 'hidden' }}
      >
        {layout.map(tile => {
          const hue = (tile.idx * 137.508) % 360;
          return (
            <div
              key={tile.idx}
              className={`arcade-selector__navmap-item ${tile.idx === selectedIndex ? "active" : ""}`}
              style={{
                left: `${tile.x}px`,
                top: `${tile.y}px`,
                width: `${tile.w}px`,
                height: `${tile.h}px`,
                backgroundColor: `hsl(${hue}, 40%, 20%)`,
              }}
            >
              {resolveImage(items[tile.idx]) ? (
                <img
                  src={resolveImage(items[tile.idx])}
                  alt={items[tile.idx].label}
                />
              ) : (
                <span className="arcade-selector__navmap-placeholder" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
