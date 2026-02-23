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

const VISIBLE_COUNT = 7;
const HALF = Math.floor(VISIBLE_COUNT / 2);

/**
 * ArcadeSelector: Hero-style game selector with large boxart on the left
 * and a vertically scrolling game list on the right.
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
  const listRef = useRef(null);
  const navmapRef = useRef(null);
  const rootRef = useRef(null);
  const prevSelectedRef = useRef(selectedIndexProp);
  const [thumbW, setThumbW] = useState(0); // 0 = hidden until computed

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

  // --- Keyboard navigation ---
  const handleKeyDown = useCallback(
    (e) => {
      if (!items.length) return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          {
            const next = (selectedIndex - 1 + items.length) % items.length;
            setSelectedIndex(next, findKeyForItem(items[next]));
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          {
            const next = (selectedIndex + 1) % items.length;
            setSelectedIndex(next, findKeyForItem(items[next]));
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          handleClose();
          break;

        case "ArrowRight":
          // no-op
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
    [items, selectedIndex, onSelect, handleClose, setSelectedIndex, findKeyForItem, logger]
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

      // Slot-machine roller on the list
      const prev = prevSelectedRef.current;
      const delta = selectedIndex - prev;
      // Determine direction: handle wrapping (jumping from last→first = down, first→last = up)
      let direction;
      if (Math.abs(delta) > items.length / 2) {
        direction = delta < 0 ? 1 : -1; // wrapped
      } else {
        direction = delta > 0 ? 1 : -1;
      }
      const rollPx = direction * 72; // roughly one row height

      listRef.current?.animate(
        [
          { transform: `translateY(${rollPx}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );

      prevSelectedRef.current = selectedIndex;
    }
  }, [selectedIndex, items, logger]);

  // --- Lifecycle logging ---
  useEffect(() => {
    logger.info("mounted", { itemCount: items.length });
    return () => logger.debug("unmounted");
  }, [logger, items.length]);

  // --- Navmap layout: right-size thumbs to fill the entire panel ---
  // For each possible column count, compute the exact width and height
  // that fills the space. Pick the layout with the largest thumb area.
  useEffect(() => {
    const nav = navmapRef.current;
    if (!nav || !items.length) return;
    const containerH = nav.clientHeight - 8;
    const navW = nav.clientWidth - 8;
    const GAP = 2;
    const n = items.length;

    // Try every valid column count. Pick the one that maximizes
    // total thumb area while still fitting vertically.
    const ASPECT = 1.35;
    let bestW = 20;
    let bestFill = 0;
    for (let cols = 1; cols <= n; cols++) {
      const perCol = Math.ceil(n / cols);
      const colW = Math.floor((navW - (cols - 1) * GAP) / cols);
      if (colW < 20) break;
      const itemH = colW * ASPECT;
      const totalH = perCol * (itemH + GAP);
      if (totalH > containerH) continue;
      const fill = n * colW * itemH;
      if (fill > bestFill) {
        bestFill = fill;
        bestW = colW;
      }
    }
    setThumbW(bestW);
  }, [items.length]);

  // Post-render: if actual images overflow, shrink until they fit
  useEffect(() => {
    const nav = navmapRef.current;
    if (!nav || !thumbW) return;
    const raf = requestAnimationFrame(() => {
      if (nav.scrollHeight > nav.clientHeight + 4) {
        setThumbW((prev) => Math.max(20, prev - 4));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [thumbW]);

  // --- Compute visible items (7-item window centered on selection) ---
  const currentItem = items[selectedIndex] || {};
  const heroImage = resolveImage(currentItem);

  const visibleItems = useMemo(() => {
    if (!items.length) return [];
    const result = [];
    for (let offset = -HALF; offset <= HALF; offset++) {
      const idx = ((selectedIndex + offset) % items.length + items.length) % items.length;
      result.push({ item: items[idx], index: idx, offset });
    }
    return result;
  }, [items, selectedIndex]);

  if (!items.length) return null;

  return (
    <div className="arcade-selector" ref={rootRef}>
      {/* LEFT: Hero panel */}
      <div className="arcade-selector__hero">
        <div className="arcade-selector__hero-art" ref={heroArtRef}>
          {heroImage && <img src={heroImage} alt={currentItem.label} />}
        </div>
        <div className="arcade-selector__hero-info">
          <h1 className="arcade-selector__title">{currentItem.label}</h1>
          {currentItem.parentTitle && (
            <p className="arcade-selector__console">{currentItem.parentTitle}</p>
          )}
        </div>
      </div>

      {/* RIGHT: Scrollable game list */}
      <div className="arcade-selector__list" ref={listRef}>
        {visibleItems.map(({ item, index, offset }) => (
          <div
            key={index}
            className={`arcade-selector__list-item ${offset === 0 ? "active" : ""}`}
            data-distance={Math.abs(offset)}
          >
            <div className="arcade-selector__list-thumb">
              {resolveImage(item) && (
                <img src={resolveImage(item)} alt={item.label} />
              )}
            </div>
            <div className="arcade-selector__list-text">
              <span className="arcade-selector__list-label">{item.label}</span>
              {item.parentTitle && (
                <span className="arcade-selector__list-system">{item.parentTitle}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* FAR RIGHT: Navmap — flex-wrap column, auto columns */}
      <div
        className="arcade-selector__navmap"
        ref={navmapRef}
        style={{ '--thumb-w': `${thumbW}px`, visibility: thumbW ? 'visible' : 'hidden' }}
      >
        {items.map((item, index) => (
          <div
            key={index}
            className={`arcade-selector__navmap-item ${index === selectedIndex ? "active" : ""}`}
          >
            {resolveImage(item) ? (
              <img src={resolveImage(item)} alt={item.label} />
            ) : (
              <span className="arcade-selector__navmap-placeholder" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
