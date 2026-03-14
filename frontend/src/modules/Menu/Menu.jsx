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
const MenuIMG = React.memo(function MenuIMG({ img, label }) {
  const [state, setState] = useState('loading'); // loading | loaded | error

  const handleLoad = useCallback(() => setState('loaded'), []);
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
    <div className={`menu-item-img ${state === 'loading' ? 'loading' : ''}`}>
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
const MenuItem = React.memo(function MenuItem({ item, isActive, isDisabled, image, imageKey, itemKey, MENU_TIMEOUT, timeLeft, totalTime }) {
  return (
    <div
      key={itemKey}
      className={`menu-item ${item.type || ""} ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
    >
      {!!MENU_TIMEOUT && isActive && (
        <ProgressTimeoutBar timeLeft={timeLeft} totalTime={MENU_TIMEOUT} />
      )}
      <MenuIMG key={imageKey} img={image} label={item.label} />
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
  // rest load in batches of 2 during idle to avoid cold-start jank
  const imageReadyCount = useProgressiveImages(items.length, 10, 2);

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
   * Reset scroll position at component mount: always start at the top.
   */
  useEffect(() => {
    if (containerRef?.current) {
      containerRef.current.style.transform = "translateY(0)";
    }
  }, [containerRef]);

  /**
   * Keyboard navigation for menu items.
   */
  const handleKeyDown = useCallback(
    (e) => {
      if (!items.length) return;

      const key = e.key;
      const synthetic = !!e.__gamepadSynthetic;
      const isBack = key === "Escape" || key === "GamepadSelect";
      const isModifier = key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "Tab";

      logger.debug("keydown", { key, code: e.code, synthetic, isBack, isModifier });

      if (key === "ArrowUp") {
        e.preventDefault();
        const next = (selectedIndex - columns + items.length) % items.length;
        setSelectedIndex(next, findKeyForItem(items[next]));
      } else if (key === "ArrowDown") {
        e.preventDefault();
        const next = (selectedIndex + columns) % items.length;
        setSelectedIndex(next, findKeyForItem(items[next]));
      } else if (key === "ArrowLeft") {
        e.preventDefault();
        const next = (selectedIndex - 1 + items.length) % items.length;
        setSelectedIndex(next, findKeyForItem(items[next]));
      } else if (key === "ArrowRight") {
        e.preventDefault();
        const next = (selectedIndex + 1) % items.length;
        setSelectedIndex(next, findKeyForItem(items[next]));
      } else if (isBack) {
        e.preventDefault();
        handleClose();
      } else if (!isModifier) {
        // Any non-navigation, non-back, non-modifier key is select
        e.preventDefault();
        onSelect?.(items[selectedIndex]);
      }
    },
    [items, selectedIndex, onSelect, handleClose, columns, setSelectedIndex, findKeyForItem]
  );

  /**
   * Attach/detach the global keydown listener.
   */
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /**
   * Optional countdown timer to auto-select.
   */
  const { timeLeft, resetTime } = useProgressTimeout(MENU_TIMEOUT, () => {
    onSelect?.(items[selectedIndex]);
  });

  useEffect(() => {
    if (MENU_TIMEOUT > 0 && items.length) {
      resetTime();
    }
  }, [selectedIndex, items, MENU_TIMEOUT, resetTime]);

  /**
   * Scroll the container so the active item remains in view.
   * Uses rAF to batch DOM reads and the transform write, avoiding forced reflow.
   * Keeps header visible when top rows are selected.
   */
  useEffect(() => {
    if (!containerRef?.current || !items.length) return;

    const rafId = requestAnimationFrame(() => {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const containerHeight = containerEl.offsetHeight;

      const menuItemsEl = containerEl.querySelector(".menu-items");
      if (!menuItemsEl) return;

      // Check if scrolling is needed
      const lastElem = menuItemsEl.children[menuItemsEl.children.length - 1];
      if (lastElem) {
        const lastItemBottom = lastElem.offsetTop + lastElem.offsetHeight;
        if (lastItemBottom <= containerHeight + 5) {
          containerEl.style.transform = `translateY(0px)`;
          return;
        }
      }

      const selectedElem = menuItemsEl.children[selectedIndex];
      if (!selectedElem) return;

      const selectedHeight = selectedElem.offsetHeight;
      const selectedTop = selectedElem.offsetTop;

      // Keep header visible: don't scroll if selected item is in the top portion
      const headerHeight = containerEl.querySelector('.menu-header')?.offsetHeight || 0;
      const headerBuffer = headerHeight + 16; // header + gap
      const selectedBottom = selectedTop + selectedHeight;

      let newTranslateY;
      if (selectedBottom <= containerHeight) {
        // Item fully visible without scrolling — keep header in view
        newTranslateY = 0;
      } else {
        // Center the selected item, but never scroll past the header
        const centerTarget = selectedTop - containerHeight / 2 + selectedHeight / 2;
        const maxScroll = containerEl.scrollHeight - containerHeight;
        newTranslateY = Math.max(0, Math.min(maxScroll, centerTarget));
      }
      containerEl.style.transform = `translateY(${-newTranslateY}px)`;
    });

    return () => cancelAnimationFrame(rafId);
  }, [selectedIndex, items, containerRef]);

  /**
   * A small child component for rendering the countdown progress bar (if used).
   */
  const ProgressTimeoutBar = ({ timeLeft, totalTime }) => {
    if (totalTime <= 0) return null;
    const percentage = 100 - (timeLeft / totalTime) * 100;
    return (
      <div className="progress-bar">
        <div className="progress" style={{ width: `${percentage}%` }} />
      </div>
    );
  };

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
  // Images are gated by imageReadyCount — items beyond the viewport start
  // with gradient placeholders and receive images progressively during idle.
  const itemData = useMemo(() => items.map((item, index) => {
    // Check all action types for contentId (play, queue, list, open, display)
    const actionObj = item?.play || item?.queue || item?.list || item?.open || {};
    const itemContentId = actionObj?.contentId;
    const plex = actionObj?.plex;
    const itemKey = findKeyForItem(item) || `${index}-${item.label}`;

    // Only load images for items within the ready count
    let image = index < imageReadyCount ? item.image : null;

    if (image && (image.startsWith('/media/img/') || image.startsWith('media/img/'))) {
      image = DaylightMediaPath(image);
    }

    if (!image && index < imageReadyCount && (itemContentId || plex)) {
      const displayId = itemContentId || plex;
      const val = Array.isArray(displayId) ? displayId[0] : displayId;
      image = ContentDisplayUrl(val);
    }

    const imageKey = image ? `img-${image}` : `no-img-${itemKey}`;
    const isAndroid = !!item.android;
    const isDisabled = isAndroid && !_fkbAvailable;

    return { item, itemKey, image, imageKey, isDisabled };
  }), [items, findKeyForItem, imageReadyCount]);

  return (
    <div className={`menu-items count_${items.length}`}>
      {itemData.map(({ item, itemKey, image, imageKey, isDisabled }, index) => {
        const isActive = index === selectedIndex;

        return (
          <MenuItem
            key={itemKey}
            item={item}
            isActive={isActive}
            isDisabled={isDisabled}
            image={image}
            imageKey={imageKey}
            itemKey={itemKey}
            MENU_TIMEOUT={MENU_TIMEOUT}
            timeLeft={timeLeft}
            totalTime={MENU_TIMEOUT}
          />
        );
      })}
    </div>
  );
}
