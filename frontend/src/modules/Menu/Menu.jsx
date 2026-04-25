import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { DaylightAPI, DaylightMediaPath, ContentDisplayUrl } from "../../lib/api.mjs";
import getLogger from "../../lib/logging/Logger.js";
import "./Menu.scss";
import MenuNavigationContext from "../../context/MenuNavigationContext";
import { MenuSkeleton } from "./MenuSkeleton";
import { ArcadeSelector } from "./ArcadeSelector";
import { isFKBAvailable } from '../../lib/fkb.js';
import { useMenuPerfMonitor } from './hooks/useMenuPerfMonitor.js';

/**
 * Logs a menu selection to the server.
 */
const logMenuSelection = async (item) => {
  const mediaKey = item?.play || item?.queue || item?.list || item?.open || item?.launch
    || (item?.android ? { contentId: `android:${item.android.package}` } : null);
  if (!mediaKey) return;

  const selectedKey = Array.isArray(mediaKey)
    ? mediaKey[0]
    : Object.values(mediaKey)?.length
      ? Object.values(mediaKey)[0]
      : null;

  if (selectedKey) {
    await DaylightAPI("api/v1/list/menu-log", { assetId: selectedKey });
  }
};

const scheduleDeferredTask = (() => {
  if (typeof queueMicrotask === "function") {
    return queueMicrotask;
  }
  const resolved = Promise.resolve();
  return (cb) => resolved.then(cb);
})();

/**
 * A custom hook to wrap the "onSelect" callback with a logging side-effect.
 * Calls are deferred to avoid cross-component setState warnings during render.
 */
function useSelectAndLog(onSelectCallback) {
  return useCallback(
    (item) => {
      if (!item || !onSelectCallback) return;
      scheduleDeferredTask(() => {
        onSelectCallback(item);
        logMenuSelection(item);
      });
    },
    [onSelectCallback]
  );
}

/**
 * HeaderClock: Isolated clock component. Re-renders every second
 * but is wrapped in React.memo so it never cascades to parent/siblings.
 */
const HeaderClock = React.memo(function HeaderClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formatDate = (date) =>
    date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="menu-header-datetime">
      <span className="menu-header-time">{formatTime(time)}</span>
      <span className="menu-header-date">{formatDate(time)}</span>
    </div>
  );
});

/**
 * MenuHeader: Displays the menu title with item count and current time.
 * Memoized — only re-renders when title/itemCount/image change.
 */
const MenuHeader = React.memo(function MenuHeader({ title, itemCount, image }) {
  return (
    <header className="menu-header">
      <div className="menu-header-left">
        {image && <img src={image} alt="" className="menu-header-thumb" />}
        <h2>{title}</h2>
      </div>
      <div className="menu-header-center">
        <HeaderClock />
      </div>
      <div className="menu-header-right">
        {itemCount > 0 && (
          <span className="menu-header-count">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </header>
  );
});

function MenuEmpty({ title, image, message }) {
  return (
    <div className="menu-items-container">
      <MenuHeader title={title} itemCount={0} image={image} />
      <div className="menu-empty-state">{message}</div>
    </div>
  );
}

/**
 * TVMenu: Main menu component.
 * Supports both legacy controlled mode and new context-based mode.
 * 
 * When depth is provided and MenuNavigationContext is available, uses context for state.
 * Otherwise falls back to controlled/uncontrolled pattern with props.
 */
export function TVMenu({
  list,
  depth,
  selectedIndex: selectedIndexProp = 0,
  selectedKey: selectedKeyProp = null,
  onSelectedIndexChange,
  onSelect,
  onEscape,
  refreshToken = 0,
  MENU_TIMEOUT = 0,
}) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list, refreshToken);
  const containerRef = useRef(null);
  const handleSelect = useSelectAndLog(onSelect);

  if (!loaded) {
    return <MenuSkeleton />;
  }

  if (menuMeta.menuStyle === 'arcade') {
    return (
      <ArcadeSelector
        items={menuItems}
        depth={depth}
        selectedKey={selectedKeyProp}
        selectedIndex={selectedIndexProp}
        onSelectedIndexChange={onSelectedIndexChange}
        onSelect={handleSelect}
        onClose={onEscape}
      />
    );
  }

  const styleClass = menuMeta.menuStyle ? `menu-items-container--${menuMeta.menuStyle}` : '';

  return (
    <div className={`menu-items-container ${styleClass}`} ref={containerRef}>
      <MenuHeader
        title={menuMeta.title || menuMeta.label}
        itemCount={menuItems.length}
        image={menuMeta.image}
      />
      <MenuItems
        items={menuItems}
        columns={5}
        depth={depth}
        selectedKey={selectedKeyProp}
        selectedIndex={selectedIndexProp}
        onSelectedIndexChange={onSelectedIndexChange}
        onSelect={handleSelect}
        onClose={onEscape}
        MENU_TIMEOUT={MENU_TIMEOUT}
        containerRef={containerRef}
      />
    </div>
  );
}

/**
 * KeypadMenu: A variant of TVMenu that also shows a loading overlay if not loaded
 * and can auto-select an item after a timeout.
 */
export function KeypadMenu({
  list,
  onSelection,
  onClose,
  onMenuState,
  MENU_TIMEOUT = 3000,
}) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list);
  const containerRef = useRef(null);
  const handleSelect = useSelectAndLog(onSelection);

  useEffect(() => {
    onMenuState?.(true);
    return () => onMenuState?.(false);
  }, [onMenuState]);

  if (!loaded) {
    return <MenuSkeleton />;
  }

  if (!menuItems.length) {
    return (
      <MenuEmpty
        title={menuMeta.title || menuMeta.label || "Menu"}
        image={menuMeta.image}
        message="No items available"
      />
    );
  }

  const styleClass = menuMeta.menuStyle ? `menu-items-container--${menuMeta.menuStyle}` : '';

  return (
    <div className={`menu-items-container ${styleClass}`} ref={containerRef}>
      <MenuHeader
        title={menuMeta.title || menuMeta.label || "Menu"}
        itemCount={menuItems.length}
        image={menuMeta.image}
      />
      <MenuItems
        items={menuItems}
        columns={5}
        onSelect={handleSelect}
        onClose={onClose}
        MENU_TIMEOUT={MENU_TIMEOUT}
        containerRef={containerRef}
      />
    </div>
  );
}

/**
 * A hook to handle an optional countdown that invokes a callback.
 */
function useProgressTimeout(timeout = 0, onTimeout, interval = 15) {
  const [timeLeft, setTimeLeft] = useState(timeout);
  const timerRef = useRef(null);
  const callbackRef = useRef(onTimeout);

  useEffect(() => {
    callbackRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!timeout || timeout <= 0) {
      setTimeLeft(0);
      return;
    }
    setTimeLeft(timeout);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const newVal = prev - interval;
        if (newVal <= 0) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          callbackRef.current?.();
          return 0;
        }
        return newVal;
      });
    }, interval);

    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [timeout, interval]);

  const resetTime = useCallback(() => {
    if (timerRef.current) {
      setTimeLeft(timeout);
    }
  }, [timeout]);

  return { timeLeft, resetTime };
}

/**
 * Fetches menu data (either from a local object, server API, or a string path).
 */
function useFetchMenuData(listInput, refreshToken = 0) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuMeta, setMenuMeta] = useState({
    title: "Loading...",
    image: "",
    kind: "default",
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let canceled = false;
    setLoaded(false);

    async function fetchData(target, config) {
      // Append recent_on_top config, using "+" to join if there are other configs
      config = config ? `${config}+recent_on_top` : "recent_on_top";
      if (!target) {
        return {
          title: "No Menu",
          image: "",
          kind: "default",
          items: [],
        };
      }
      const data = await DaylightAPI(
        `api/v1/list/watchlist/${target}${config ? `/${config}` : ""}`
      );
      if (canceled) return null;
      return { 
        title: data.title || data.label, 
        image: data.image, 
        kind: data.kind, 
        items: data.items 
      };
    }

    async function fetchContentIdList(target, config) {
      config = config ? `${config}+recent_on_top` : "recent_on_top";
      if (!target) {
        return {
          title: "No Menu",
          image: "",
          kind: "default",
          items: [],
        };
      }
      const data = await DaylightAPI(
        `api/v1/list/${target}${config ? `/${config}` : ""}`
      );
      if (canceled) return null;
      return {
        title: data.title || data.label,
        image: data.image,
        kind: data.kind,
        items: data.items
      };
    }

    async function loadListData(input) {
      if (!input) {
        setMenuItems([]);
        setMenuMeta({ title: "No Menu", image: "", kind: "default" });
        setLoaded(true);
        return;
      }

      // (A) If the input is already a "menu object" with items
      if (Array.isArray(input?.items)) {
        const { items, ...rest } = input;
        setMenuItems(items);
        setMenuMeta(rest);
        setLoaded(true);
        return;
      }

      // (B) If the input is a string referencing a menu path
      if (typeof input === "string") {
        const data = await fetchData(input);
        if (data) {
          setMenuItems(data.items);
          setMenuMeta({
            title: data.title,
            image: data.image,
            kind: data.kind,
          });
        }
        setLoaded(true);
        return;
      }

      // (C) If the input is an object with "menu", "list", "plex", "watchlist", or "contentId"
      if (typeof input === "object") {
        const { menu, list, plex, watchlist, contentId, shuffle, playable, menuStyle } = input;
        const config = [];
        if (shuffle) config.push("shuffle");
        if (playable) config.push("playable");
        const param = menu || list || plex || watchlist;
        // contentId uses api/v1/list/ directly (already includes source type)
        const resolvedParam = param || (contentId ? contentId.replace(':', '/') : null);
        const useWatchlistPrefix = !!param; // Only use watchlist/ prefix for legacy keys
        if (resolvedParam) {
          const data = useWatchlistPrefix
            ? await fetchData(resolvedParam, config.join("+"))
            : await fetchContentIdList(resolvedParam, config.join("+"));
          if (data) {
            setMenuItems(data.items);
            setMenuMeta({
              title: data.title,
              image: data.image,
              kind: data.kind,
              menuStyle,
            });
          }
        } else {
          setMenuItems([]);
          setMenuMeta({ title: "No Menu", image: "", kind: "default" });
        }
        setLoaded(true);
        return;
      }

      // (D) Fallback
      setMenuItems([]);
      setMenuMeta({ title: "No Menu", image: "", kind: "default" });
      setLoaded(true);
    }

    loadListData(listInput);

    return () => {
      canceled = true;
    };
  }, [listInput, refreshToken]);

  return { menuItems, menuMeta, loaded };
}

/**
 * Generate a consistent gradient based on a string (label).
 * Same label always produces the same colors.
 */
function generateGradientFromLabel(label) {
  // Simple hash function
  let hash = 0;
  const str = label || 'default';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate two hues from the hash (offset by 30-60 degrees for harmony)
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 30 + (Math.abs(hash >> 8) % 30)) % 360;
  
  // Use muted saturation and medium lightness for pleasant colors
  const sat = 50 + (Math.abs(hash >> 4) % 20); // 50-70%
  const light = 35 + (Math.abs(hash >> 6) % 15); // 35-50%
  
  return `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${light}%) 0%, hsl(${hue2}, ${sat - 10}%, ${light - 10}%) 100%)`;
}

/**
 * MenuIMG: Lightweight image component.
 * - Single state update on load (was 3 before — orientation, aspectRatio, loading)
 * - No blur background (was the #1 GPU cost on Shield)
 * - Uses object-fit: cover always (no orientation detection needed for cover mode)
 * - Memoized to prevent re-render on parent state changes
 */
/**
 * Extract dominant color from left+right edges of an image via a tiny canvas.
 * Runs once per image load — sets background-color on the container so
 * pillarboxed/letterboxed images get a color-matched fill instead of black.
 * Darkened to 60% to keep it subtle.
 */
function extractDominantColor(imgEl, containerEl) {
  try {
    const c = document.createElement('canvas');
    const w = Math.min(imgEl.naturalWidth, 50);
    const h = Math.min(imgEl.naturalHeight, 50);
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    let r = 0, g = 0, b = 0, n = 0;
    // Sample left edge
    const left = ctx.getImageData(0, 0, 1, h);
    for (let i = 0; i < left.data.length; i += 4) {
      r += left.data[i]; g += left.data[i + 1]; b += left.data[i + 2]; n++;
    }
    // Sample right edge
    const right = ctx.getImageData(w - 1, 0, 1, h);
    for (let i = 0; i < right.data.length; i += 4) {
      r += right.data[i]; g += right.data[i + 1]; b += right.data[i + 2]; n++;
    }

    r = Math.round(r / n * 0.6);
    g = Math.round(g / n * 0.6);
    b = Math.round(b / n * 0.6);
    containerEl.style.backgroundColor = `rgb(${r},${g},${b})`;
  } catch (_) {
    // CORS or canvas tainted — keep default background
  }
}

const MenuIMG = React.memo(function MenuIMG({ img, label }) {
  const [state, setState] = useState('loading'); // loading | loaded | error
  const containerRef = useRef(null);

  const handleLoad = useCallback((e) => {
    setState('loaded');
    if (containerRef.current) extractDominantColor(e.target, containerRef.current);
  }, []);
  const handleError = useCallback(() => setState('error'), []);

  if (!img || state === 'error') {
    const gradient = generateGradientFromLabel(label);
    return (
      <div className="menu-item-img no-image" style={{ background: gradient }}>
        <div className="menu-item-img-icon">
          <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" opacity="0.3">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5-7l-3 3.72L9 13l-3 4h12l-4-5z"/>
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`menu-item-img ${state === 'loading' ? 'loading' : ''}`}>
      <img
        src={img}
        alt={label}
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        style={{ display: state === 'loading' ? 'none' : 'block' }}
      />
    </div>
  );
});

/**
 * Memoized individual menu item — only re-renders when isActive or item data changes.
 * This eliminates 32 of 34 re-renders per keystroke (only old + new active items update).
 */
const MenuItem = React.memo(function MenuItem({ item, isActive, isDisabled, imageSrc, imageReady, itemKey }) {
  const img = imageReady ? imageSrc : null;
  const imageKey = img ? `img-${img}` : `no-img-${itemKey}`;
  return (
    <div
      className={`menu-item ${item.type || ""} ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
    >
      <MenuIMG key={imageKey} img={img} label={item.label} />
      <h3 className="menu-item-label">{item.label}</h3>
    </div>
  );
});

// Cache FKB availability once at module load (won't change during session)
const _fkbAvailable = isFKBAvailable();

/**
 * Progressively reveals images beyond the initial viewport.
 * Only the first `initialCount` items get images immediately;
 * the rest load in batches via requestIdleCallback to avoid
 * cold-start jank from 34 concurrent image decodes.
 *
 * @param {number} totalItems - Total number of menu items
 * @param {number} initialCount - Items to show immediately (visible viewport)
 * @param {number} batchSize - Items to reveal per idle callback
 * @returns {number} Count of items whose images are ready
 */
function useProgressiveImages(totalItems, initialCount = 10, batchSize = 2) {
  const [readyCount, setReadyCount] = useState(() => Math.min(initialCount, totalItems));

  useEffect(() => {
    if (readyCount >= totalItems) return;

    const schedule = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb) => setTimeout(cb, 50);
    const cancel = typeof cancelIdleCallback === 'function'
      ? cancelIdleCallback
      : clearTimeout;

    let id;
    function loadNext() {
      setReadyCount(prev => {
        const next = Math.min(prev + batchSize, totalItems);
        if (next < totalItems) {
          id = schedule(loadNext);
        }
        return next;
      });
    }

    id = schedule(loadNext);
    return () => cancel(id);
  }, [totalItems, readyCount, batchSize]);

  // Reset when item count changes (new menu loaded)
  useEffect(() => {
    setReadyCount(Math.min(initialCount, totalItems));
  }, [totalItems, initialCount]);

  return readyCount;
}

/**
 * MenuItems: Renders the menu items, handles arrow keys, and manages optional timeout.
 *
 * When depth is provided, uses MenuNavigationContext for state management.
 * Otherwise falls back to controlled/uncontrolled pattern with props.
 */
function MenuItems({
  items = [],
  columns = 1,
  depth,
  selectedIndex: selectedIndexProp = 0,
  selectedKey = null,
  onSelectedIndexChange,
  onSelect,
  onClose,
  MENU_TIMEOUT = 0,
  containerRef,
}) {
  const logger = useMemo(() => getLogger().child({ component: 'MenuItems' }), []);
  // Try to get context (may be null if not within provider)
  const navContext = useContext(MenuNavigationContext);
  const useContextMode = depth !== undefined && navContext !== null;
  
  // Use controlled component pattern if onSelectedIndexChange is provided (legacy mode)
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0);
  const [internalSelectedKey, setInternalSelectedKey] = useState(null);
  const isControlled = onSelectedIndexChange !== undefined;
  
  // Determine selected index and key based on mode
  let selectedIndex, currentKey;
  if (useContextMode) {
    const selection = navContext.getSelection(depth);
    selectedIndex = selection.index;
    currentKey = selection.key;
  } else if (isControlled) {
    selectedIndex = selectedIndexProp;
    currentKey = selectedKey;
  } else {
    selectedIndex = internalSelectedIndex;
    currentKey = internalSelectedKey;
  }

  // Jank monitoring — writes to media/logs/screens/
  useMenuPerfMonitor(items.length > 0, selectedIndex);

  // Progressive image loading — first 10 items get images immediately,
  // rest load all at once after a single idle callback to avoid interfering with navigation
  const imageReadyCount = useProgressiveImages(items.length, 10, items.length);

  const findKeyForItem = useCallback((item) => {
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    const androidKey = item?.android ? `android:${item.android.package}` : null;
    return item?.id ?? item?.key ?? actionVal ?? androidKey ?? item?.label ?? null;
  }, []);
  
  const setSelectedIndex = useCallback((value, key = null) => {
    const resolve = (v) => (typeof v === 'function' ? v(selectedIndex) : v);
    const nextIndex = resolve(value);
    const nextKey = key ?? null;

    if (useContextMode) {
      navContext.setSelectionAtDepth(depth, nextIndex, nextKey);
    } else if (isControlled) {
      if (nextIndex === selectedIndexProp && nextKey === selectedKey) {
        return; // no-op to avoid update loops
      }
      onSelectedIndexChange(nextIndex, nextKey);
    } else {
      if (nextIndex === internalSelectedIndex && nextKey === internalSelectedKey) {
        return; // no-op
      }
      setInternalSelectedIndex(nextIndex);
      setInternalSelectedKey(nextKey);
    }
  }, [useContextMode, navContext, depth, isControlled, selectedIndex, selectedIndexProp, selectedKey, internalSelectedIndex, internalSelectedKey, onSelectedIndexChange]);

  // Handle escape/back navigation
  const handleClose = useCallback(() => {
    if (useContextMode) {
      navContext.pop();
    } else {
      onClose?.();
    }
  }, [useContextMode, navContext, onClose]);

  /**
   * DOM-direct navigation — bypasses React for arrow key handling.
   * Like a native RecyclerView: swap CSS classes on 2 DOM elements, update scroll.
   * React state only updates on Enter (selection) or when items change.
   */
  const activeIndexRef = useRef(selectedIndex);

  // Refs for stable keydown handler (never recreates → no addEventListener churn)
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  // Refs so the gamepad polling effect can see current callbacks/values
  // without restarting on every selection change. Restarting would reset
  // prevButtons/selectCooldown and re-fire a still-held A press.
  const setSelectedIndexRef = useRef(null);
  setSelectedIndexRef.current = setSelectedIndex;
  const findKeyForItemRef = useRef(null);
  findKeyForItemRef.current = findKeyForItem;
  const navigateToRef = useRef(null); // assigned after navigateTo is declared below
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  /**
   * Cache item positions after initial render to avoid forced layout reads during navigation.
   * Positions are measured once, then navigation uses cached values — zero DOM queries.
   */
  const layoutCacheRef = useRef(null);
  const coverTimerRef = useRef(null);
  const progressBarRef = useRef(null);
  const resetTimeRef = useRef(null);

  const buildLayoutCache = useCallback(() => {
    const containerEl = containerRef?.current;
    if (!containerEl) return;
    const menuItemsEl = containerEl.querySelector(".menu-items");
    if (!menuItemsEl) return;

    const containerHeight = containerEl.offsetHeight;
    const menuItemsTop = menuItemsEl.offsetTop;
    const scrollHeight = containerEl.scrollHeight;
    const positions = [];

    for (let i = 0; i < menuItemsEl.children.length; i++) {
      const el = menuItemsEl.children[i];
      positions.push({
        top: menuItemsTop + el.offsetTop,
        height: el.offsetHeight,
      });
    }

    layoutCacheRef.current = { containerHeight, scrollHeight, positions };
  }, [containerRef]);

  // Build cache after images load (layout settles)
  useEffect(() => {
    const timer = setTimeout(buildLayoutCache, 500);
    return () => clearTimeout(timer);
  }, [buildLayoutCache, imageReadyCount]);

  /**
   * Swap active class directly on DOM — O(1), no React render, no DOM reads.
   * Uses cached positions for scroll calculation.
   */
  const navigateTo = useCallback((nextIndex) => {
    const containerEl = containerRef?.current;
    if (!containerEl) return;
    const menuItemsEl = containerEl.querySelector(".menu-items");
    if (!menuItemsEl) return;

    const prevIndex = activeIndexRef.current;
    if (nextIndex === prevIndex) return;

    // Clear ALL active classes — defensive against stale state after remount
    menuItemsEl.querySelectorAll(".menu-item.active").forEach(el => {
      el.classList.remove("active", "cover");
    });
    const nextEl = menuItemsEl.children[nextIndex];
    if (nextEl) nextEl.classList.add("active");

    // Move the progress bar to the new active item
    if (progressBarRef.current && nextEl) {
      nextEl.prepend(progressBarRef.current);
    }

    // Delay the cover+pan so contain→cover zoom doesn't jank navigation
    if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
    coverTimerRef.current = setTimeout(() => {
      if (nextEl && nextEl.classList.contains("active")) nextEl.classList.add("cover");
    }, 500);

    activeIndexRef.current = nextIndex;

    // Reset auto-select countdown when selection moves (numpad cycling)
    resetTimeRef.current?.();

    // Scroll using cached positions — zero DOM reads
    const cache = layoutCacheRef.current;
    if (!cache || !cache.positions[nextIndex]) {
      // Fallback: rebuild cache if missing (first nav before cache ready)
      buildLayoutCache();
      return;
    }

    // Only scroll if 3+ rows — short menus (1-2 rows) stay put
    const totalRows = Math.ceil(cache.positions.length / columns);
    const didScroll = totalRows > 2 && cache.scrollHeight > cache.containerHeight && nextIndex >= columns;
    if (!didScroll) {
      containerEl.style.transform = `translateY(0px)`;
    } else {
      const pos = cache.positions[nextIndex];
      const centerTarget = pos.top - cache.containerHeight / 2 + pos.height / 2;
      const maxScroll = cache.scrollHeight - cache.containerHeight;
      containerEl.style.transform = `translateY(${-Math.max(0, Math.min(maxScroll, centerTarget))}px)`;
    }

    // Diagnostic: log scroll decision for 2-row menu bug investigation
    logger.sampled('menu.scroll.decision', {
      totalRows, columns, positionsLength: cache.positions.length,
      scrollHeight: cache.scrollHeight, containerHeight: cache.containerHeight,
      nextIndex, didScroll,
    }, { maxPerMinute: 10 });
  }, [containerRef, columns, buildLayoutCache]);
  navigateToRef.current = navigateTo;

  // Restore or reset scroll + active index when items change or on (re-)mount.
  // If the context has a saved selection for this depth, restore to it (back navigation).
  // Otherwise reset to 0 (new submenu opened).
  useEffect(() => {
    const savedIndex = selectedIndex;  // from context or prop — already restored by mode logic
    const clampedIndex = items.length > 0 ? Math.min(savedIndex, items.length - 1) : 0;
    activeIndexRef.current = clampedIndex;

    // Apply active + cover classes on the correct DOM element
    const containerEl = containerRef?.current;
    if (containerEl) {
      const menuItemsEl = containerEl.querySelector(".menu-items");
      if (menuItemsEl) {
        // Diagnostic: detect stale actives (dual-selection bug)
        const staleActiveCount = menuItemsEl.querySelectorAll(".menu-item.active").length;
        if (staleActiveCount > 1) {
          logger.warn('menu.restore.staleActives', {
            staleActiveCount, savedIndex, clampedIndex, itemsLength: items.length,
          });
        }
        // Clear any stale active/cover from previous render
        menuItemsEl.querySelectorAll(".menu-item.active").forEach(el => {
          el.classList.remove("active", "cover");
        });
        const targetEl = menuItemsEl.children[clampedIndex];
        if (targetEl) {
          targetEl.classList.add("active");
          // Delay cover class for smooth zoom-in
          if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
          coverTimerRef.current = setTimeout(() => {
            if (targetEl.classList.contains("active")) targetEl.classList.add("cover");
          }, 500);
        }
      }

      // Scroll to the restored position (schedule after layout settles)
      setTimeout(() => {
        const cache = layoutCacheRef.current;
        if (!cache || !cache.positions[clampedIndex]) {
          buildLayoutCache();
        }
        const c = layoutCacheRef.current;
        const restoreRows = c ? Math.ceil(c.positions.length / columns) : 0;
        if (c && restoreRows >= 3 && c.scrollHeight > c.containerHeight && clampedIndex >= columns && c.positions[clampedIndex]) {
          const pos = c.positions[clampedIndex];
          const centerTarget = pos.top - c.containerHeight / 2 + pos.height / 2;
          const maxScroll = c.scrollHeight - c.containerHeight;
          containerEl.style.transform = `translateY(${-Math.max(0, Math.min(maxScroll, centerTarget))}px)`;
        } else {
          containerEl.style.transform = "translateY(0)";
        }
      }, 100);
    }
  }, [containerRef, items]);

  // Single stable keydown handler — never recreates
  useEffect(() => {
    let selectCooldown = false;

    const handler = (e) => {
      const curItems = itemsRef.current;
      if (!curItems.length) return;

      const key = e.key;
      const isBack = key === "Escape" || key === "GoBack" || key === "BrowserBack"
        || key === "GamepadSelect" || e.keyCode === 4;  // Android KEYCODE_BACK = 4
      const isModifier = key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "Tab";

      if (isModifier) return;

      const current = activeIndexRef.current;
      const isArrow = key.startsWith("Arrow");
      const isSelect = key === "Enter" || key === " "
        || key === "GamepadA" || key === "GamepadB"
        || key === "GamepadStart" || key === "MediaPlayPause";

      // Log all meaningful key events (sampled to avoid flood)
      if (!isArrow) {
        logger.sampled('menu.keydown', {
          key, code: e.code, keyCode: e.keyCode, isBack, isSelect,
          repeat: e.repeat, currentIndex: current, itemCount: curItems.length,
        }, { maxPerMinute: 30 });
      }

      if (isArrow) {
        e.preventDefault();
        let next;
        if (key === "ArrowUp") next = (current - columns + curItems.length) % curItems.length;
        else if (key === "ArrowDown") next = (current + columns) % curItems.length;
        else if (key === "ArrowLeft") next = (current - 1 + curItems.length) % curItems.length;
        else next = (current + 1) % curItems.length;
        navigateTo(next);
      } else if (isBack) {
        e.preventDefault();
        logger.info('menu.back', { key, code: e.code, keyCode: e.keyCode, currentIndex: current });
        handleCloseRef.current?.();
      } else if (isSelect) {
        e.preventDefault();
        // Guard: ignore key repeat and rapid duplicate events.
        // Shield TV remote fires repeated Enter at ~150ms when held,
        // each pushing a menu level — this prevents nav stack bloat.
        if (e.repeat || selectCooldown) return;
        selectCooldown = true;
        setTimeout(() => { selectCooldown = false; }, 300);
        // Sync React state on selection (Enter) — this is the only time React needs to know
        const idx = activeIndexRef.current;
        logger.info('menu.select', { key, index: idx, title: curItems[idx]?.label });
        setSelectedIndex(idx, findKeyForItem(curItems[idx]));
        onSelectRef.current?.(curItems[idx]);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [columns, navigateTo]);

  // --- Gamepad API polling (physical game controllers) ---
  // Effect deps are intentionally empty — all callbacks/values come from refs
  // updated each render. If the effect restarted on every selection change,
  // its closure state (prevButtons, selectCooldown) would reset, and a
  // still-held A press would re-fire on the next frame.
  useEffect(() => {
    let rafId;
    const prevButtons = {};
    const prevAxes = {};
    const seeded = new Set(); // gamepads that have been seeded from live state
    const AXIS_THRESHOLD = 0.5;
    const REPEAT_DELAY = 400;
    const REPEAT_INTERVAL = 120;
    const holdTimers = {};
    let selectCooldown = false;

    function clearHold(key) {
      if (holdTimers[key]) { clearTimeout(holdTimers[key]); delete holdTimers[key]; }
    }

    function navDir(dir) {
      const cur = activeIndexRef.current;
      const len = itemsRef.current.length;
      if (!len) return;
      const cols = columnsRef.current;
      let next;
      if (dir === 'up') next = (cur - cols + len) % len;
      else if (dir === 'down') next = (cur + cols) % len;
      else if (dir === 'left') next = (cur - 1 + len) % len;
      else next = (cur + 1) % len;
      navigateToRef.current?.(next);
    }

    function poll() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of gamepads) {
        if (!gp) continue;
        const id = gp.index;

        // Seed from live state on first observation of this gamepad.
        // Treats any button held at mount as "already pressed" so it does
        // not register as a fresh press until released and pressed again.
        if (!seeded.has(id)) {
          prevButtons[id] = gp.buttons.map(b => !!b?.pressed);
          prevAxes[id] = Array.from(gp.axes);
          seeded.add(id);
          // Skip edge detection for this frame; just record state.
          continue;
        }

        const pressed = (i) => gp.buttons[i]?.pressed;
        const wasPressed = (i) => prevButtons[id][i];
        const justPressed = (i) => pressed(i) && !wasPressed(i);
        const justReleased = (i) => !pressed(i) && wasPressed(i);

        // D-pad: 12=Up, 13=Down, 14=Left, 15=Right
        const dirMap = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
        for (const [btn, dir] of Object.entries(dirMap)) {
          const b = parseInt(btn);
          if (justPressed(b)) {
            navDir(dir);
            clearHold(`btn${b}`);
            holdTimers[`btn${b}`] = setTimeout(function repeat() {
              navDir(dir);
              holdTimers[`btn${b}`] = setTimeout(repeat, REPEAT_INTERVAL);
            }, REPEAT_DELAY);
          }
          if (justReleased(b)) clearHold(`btn${b}`);
        }

        // Analog stick
        const stickDirs = [
          { axis: 0, positive: true, dir: 'right', key: 'axisR' },
          { axis: 0, positive: false, dir: 'left', key: 'axisL' },
          { axis: 1, positive: true, dir: 'down', key: 'axisD' },
          { axis: 1, positive: false, dir: 'up', key: 'axisU' },
        ];
        for (const { axis, positive, dir, key } of stickDirs) {
          const val = gp.axes[axis] || 0;
          const prevVal = prevAxes[id][axis] || 0;
          const active = positive ? val > AXIS_THRESHOLD : val < -AXIS_THRESHOLD;
          const wasActive = positive ? prevVal > AXIS_THRESHOLD : prevVal < -AXIS_THRESHOLD;
          if (active && !wasActive) {
            navDir(dir);
            clearHold(key);
            holdTimers[key] = setTimeout(function repeat() {
              navDir(dir);
              holdTimers[key] = setTimeout(repeat, REPEAT_INTERVAL);
            }, REPEAT_DELAY);
          }
          if (!active && wasActive) clearHold(key);
        }

        // A button (0) = select
        if (justPressed(0) && !selectCooldown) {
          selectCooldown = true;
          setTimeout(() => { selectCooldown = false; }, 300);
          const idx = activeIndexRef.current;
          const curItems = itemsRef.current;
          logger.info('menu.gamepad-select', {
            gamepad: gp.id, index: idx, title: curItems[idx]?.label,
          });
          setSelectedIndexRef.current?.(idx, findKeyForItemRef.current?.(curItems[idx]));
          onSelectRef.current?.(curItems[idx]);
        }

        // B button (1) = back
        if (justPressed(1)) {
          logger.info('menu.gamepad-back', { gamepad: gp.id });
          handleCloseRef.current?.();
        }

        // Save state
        for (let i = 0; i < gp.buttons.length; i++) prevButtons[id][i] = pressed(i);
        for (let i = 0; i < gp.axes.length; i++) prevAxes[id][i] = gp.axes[i];
      }
      rafId = requestAnimationFrame(poll);
    }

    rafId = requestAnimationFrame(poll);
    logger.debug('menu.gamepad-polling.started');
    return () => {
      cancelAnimationFrame(rafId);
      Object.keys(holdTimers).forEach(clearHold);
      logger.debug('menu.gamepad-polling.stopped');
    };
  }, [logger]);

  /**
   * Optional countdown timer to auto-select.
   */
  const { timeLeft, resetTime } = useProgressTimeout(MENU_TIMEOUT, () => {
    onSelect?.(items[activeIndexRef.current]);
  });
  resetTimeRef.current = resetTime;

  useEffect(() => {
    if (MENU_TIMEOUT > 0 && items.length) {
      resetTime();
    }
  }, [selectedIndex, items, MENU_TIMEOUT, resetTime]);

  // Clamp the selected index when items change (instead of always resetting to 0)
  // When items change, prefer to restore by key; if not found, clamp by index
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

    // Fallback to clamped index
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
  }, [items, selectedIndex, currentKey, setSelectedIndex]);

  // Pre-compute item data outside the render loop for memoization stability.
  // IMPORTANT: imageReadyCount is NOT in the dependency array — it would bust
  // the memo for all 34 items on every progressive load increment, defeating React.memo.
  // Instead, imageReady is passed as a separate prop to MenuItem.
  const itemData = useMemo(() => items.map((item, index) => {
    const actionObj = item?.play || item?.queue || item?.list || item?.open || {};
    const itemContentId = actionObj?.contentId;
    const plex = actionObj?.plex;
    const itemKey = findKeyForItem(item) || `${index}-${item.label}`;

    let imageSrc = item.image;
    if (imageSrc && (imageSrc.startsWith('/media/img/') || imageSrc.startsWith('media/img/'))) {
      imageSrc = DaylightMediaPath(imageSrc);
    }
    if (!imageSrc && (itemContentId || plex)) {
      const displayId = itemContentId || plex;
      const val = Array.isArray(displayId) ? displayId[0] : displayId;
      imageSrc = ContentDisplayUrl(val);
    }

    const isAndroid = !!item.android;
    const isDisabled = isAndroid && !_fkbAvailable;

    return { item, itemKey, imageSrc, isDisabled };
  }), [items, findKeyForItem]);

  /**
   * Create and manage a DOM-only progress bar element.
   * Lives outside React's render tree to avoid HierarchyRequestError
   * when moving between .menu-item elements via DOM manipulation.
   */
  useEffect(() => {
    if (!MENU_TIMEOUT) return;

    // Create progress bar element once
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.className = 'progress';
    bar.appendChild(fill);
    progressBarRef.current = bar;

    // Attach to the initially active item
    const containerEl = containerRef?.current;
    const menuItemsEl = containerEl?.querySelector(".menu-items");
    const activeEl = menuItemsEl?.children[activeIndexRef.current];
    if (activeEl) activeEl.prepend(bar);

    return () => {
      bar.remove();
      progressBarRef.current = null;
    };
  }, [MENU_TIMEOUT, containerRef]);

  // Update progress bar width on each tick
  useEffect(() => {
    if (!progressBarRef.current || !MENU_TIMEOUT) return;
    const fill = progressBarRef.current.querySelector('.progress');
    if (fill) {
      const percentage = 100 - (timeLeft / MENU_TIMEOUT) * 100;
      fill.style.width = `${percentage}%`;
    }
  }, [timeLeft, MENU_TIMEOUT]);

  return (
    <div className={`menu-items count_${items.length}`}>
      {itemData.map(({ item, itemKey, imageSrc, isDisabled }, index) => {
        // Active class is set on initial render only — subsequent navigation
        // swaps classes via direct DOM manipulation (navigateTo), not React re-render
        const isActive = index === selectedIndex;

        return (
          <MenuItem
            key={itemKey}
            item={item}
            isActive={isActive}
            isDisabled={isDisabled}
            imageSrc={imageSrc}
            imageReady={index < imageReadyCount}
            itemKey={itemKey}
          />
        );
      })}
    </div>
  );
}
