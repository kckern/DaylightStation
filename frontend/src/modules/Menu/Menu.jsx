import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
} from "react";
import { DaylightAPI, DaylightMediaPath } from "../../lib/api.mjs";
import "./Menu.scss";
import { PlayerOverlayLoading } from "../Player/Player";
import MenuNavigationContext from "../../context/MenuNavigationContext";

/**
 * Logs a menu selection to the server.
 */
const logMenuSelection = async (item) => {
  const mediaKey = item?.play || item?.queue || item?.list || item?.open;
  if (!mediaKey) return;

  const selectedKey = Array.isArray(mediaKey)
    ? mediaKey[0]
    : Object.values(mediaKey)?.length
      ? Object.values(mediaKey)[0]
      : null;

  if (selectedKey) {
    await DaylightAPI("data/menu_log", { media_key: selectedKey });
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
 * MenuHeader: Displays the menu title with item count and current time.
 */
function MenuHeader({ title, itemCount, image }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <header className="menu-header">
      <div className="menu-header-left">
        {image && <img src={image} alt="" className="menu-header-thumb" />}
        <h2>{title}</h2>
      </div>
      <div className="menu-header-center">
        <div className="menu-header-datetime">
          <span className="menu-header-time">{formatTime(time)}</span>
          <span className="menu-header-date">{formatDate(time)}</span>
        </div>
      </div>
      <div className="menu-header-right">
        {itemCount > 0 && (
          <span className="menu-header-count">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </header>
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
  refreshToken = 0 
}) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list, refreshToken);
  const containerRef = useRef(null);
  const handleSelect = useSelectAndLog(onSelect);

  if (!loaded) {
    return null;
  }

  return (
    <div className="menu-items-container" ref={containerRef}>
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

  if (!loaded || !menuItems.length) {
    return <PlayerOverlayLoading shouldRender isVisible />;
  }

  return (
    <div className="menu-items-container" ref={containerRef}>
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
      config = `${config || ""}+recent_on_top`;
      if (!target) {
        return {
          title: "No Menu",
          image: "",
          kind: "default",
          items: [],
        };
      }
      // Migrated from legacy: data/list/${target}
      const data = await DaylightAPI(
        `api/list/folder/${target}${config ? `/${config}` : ""}`
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

      // (C) If the input is an object with "menu", "list", or "plex"
      if (typeof input === "object") {
        const { menu, list, plex, shuffle, playable } = input;
        const config = [];
        if (shuffle) config.push("shuffle");
        if (playable) config.push("playable");
        const param = menu || list || plex;
        if (param) {
          const data = await fetchData(param, config.join("+"));
          if (data) {
            setMenuItems(data.items);
            setMenuMeta({
              title: data.title,
              image: data.image,
              kind: data.kind,
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
 * MenuIMG: A helper component to display the menu image (and its orientation).
 */
function MenuIMG({ img, label }) {
  const [orientation, setOrientation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1);

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const ratio = naturalWidth / naturalHeight;
    const newOrientation =
      ratio > 1 ? "landscape" : ratio < 1 ? "portrait" : "square";

    setOrientation(newOrientation);
    setAspectRatio(ratio);
    setLoading(false);
  };

  // Calculate zoom and pan values based on actual aspect ratio
  // Container is 1:1, so we need to zoom until the image fills it
  const getZoomStyles = () => {
    if (!orientation || orientation === 'square') return {};
    
    if (orientation === 'portrait') {
      // Portrait: zoom = 1 / aspectRatio (e.g., 2:3 = 0.667, zoom = 1.5)
      const zoom = 1 / aspectRatio;
      // Pan range: how much we can move vertically after zoom
      // After zoom, image height = 100% * zoom, visible = 100%
      // Max pan = (zoom - 1) / zoom * 50% (as percentage of image)
      const panRange = ((zoom - 1) / zoom) * 50;
      return {
        '--img-zoom': zoom.toFixed(3),
        '--img-pan': `${panRange.toFixed(1)}%`,
      };
    } else {
      // Landscape: zoom = aspectRatio (e.g., 16:9 = 1.78, zoom = 1.78)
      const zoom = aspectRatio;
      // Pan range: how much we can move horizontally after zoom
      const panRange = ((zoom - 1) / zoom) * 50;
      return {
        '--img-zoom': zoom.toFixed(3),
        '--img-pan': `${panRange.toFixed(1)}%`,
      };
    }
  };

  // If no image, show a gradient placeholder
  if (!img) {
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

  // Show blurred background for non-square images (letterboxing/pillarboxing)
  const needsBlurBg = orientation && orientation !== 'square';
  const zoomStyles = getZoomStyles();

  return (
    <div
      className={`menu-item-img ${loading ? "loading" : ""} ${orientation}`}
      style={zoomStyles}
    >
      {needsBlurBg && (
        <div 
          className="menu-item-img-blur-bg"
          style={{ backgroundImage: `url(${img})` }}
        />
      )}
      <img
        src={img}
        alt={label}
        onLoad={handleImageLoad}
        style={{ display: loading ? "none" : "block" }}
      />
    </div>
  );
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

  const findKeyForItem = useCallback((item) => {
    const action = item?.play || item?.queue || item?.list || item?.open;
    const actionVal = action && (Array.isArray(action) ? action[0] : Object.values(action)[0]);
    return item?.id ?? item?.key ?? actionVal ?? item?.label ?? null;
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

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          onSelect?.(items[selectedIndex]);
          break;

        case "ArrowUp":
          e.preventDefault();
          {
            const next = (selectedIndex - columns + items.length) % items.length;
            setSelectedIndex(next, findKeyForItem(items[next]));
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          {
            const next = (selectedIndex + columns) % items.length;
            setSelectedIndex(next, findKeyForItem(items[next]));
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          {
            const next = (selectedIndex - 1 + items.length) % items.length;
            setSelectedIndex(next, findKeyForItem(items[next]));
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          {
            const next = (selectedIndex + 1) % items.length;
            setSelectedIndex(next, findKeyForItem(items[next]));
          }
          break;

        case "Escape":
          e.preventDefault();
          handleClose();
          break;

        default:
          // Move to the next item if it's an alphanumeric key
          if (!e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
            const key = e.key.toLowerCase();
            if (/[a-z0-9]/.test(key)) {
              e.preventDefault();
              const next = (selectedIndex + 1) % items.length;
              setSelectedIndex(next, findKeyForItem(items[next]));
            }
          }
          break;
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
   */
  useEffect(() => {
    if (!containerRef?.current || !items.length) return;
    const containerEl = containerRef.current;
    const containerHeight = containerEl.offsetHeight;
    const selectedElem =
      containerEl.querySelector(".menu-items")?.children[selectedIndex];
    if (!selectedElem) return;

    const selectedHeight = selectedElem.offsetHeight;
    const selectedTop = selectedElem.offsetTop;
    const centerTarget = selectedTop - containerHeight / 2 + selectedHeight / 2;
    const maxScroll = containerEl.scrollHeight - containerHeight;
    const newTranslateY = Math.max(0, Math.min(maxScroll, centerTarget));
    containerEl.style.transform = `translateY(${-newTranslateY}px)`;
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

  return (
    <div className={`menu-items count_${items.length}`}>
      {items.map((item, index) => {
        const { plex } = item?.play || item?.queue || item?.list || item?.open || {};
        const isActive = index === selectedIndex;
        const itemKey = findKeyForItem(item) || `${index}-${item.label}`;
        let image = item.image;

        // If there's a Plex ID but no image, build one
        if (!item.image && plex) {
          const val = Array.isArray(plex) ? plex[0] : plex;
          image = DaylightMediaPath(`/media/plex/img/${val}`);
        }

        // Create a unique key for the image to force remount when navigating menus
        const imageKey = image ? `img-${image}` : `no-img-${itemKey}`;

        return (
          <div
            key={itemKey}
            className={`menu-item ${item.type || ""} ${isActive ? "active" : ""}`}
          >
            {!!MENU_TIMEOUT && isActive && (
              <ProgressTimeoutBar timeLeft={timeLeft} totalTime={MENU_TIMEOUT} />
            )}
            <MenuIMG key={imageKey} img={image} label={item.label} />
            <h3 className="menu-item-label">{item.label}</h3>
          </div>
        );
      })}
    </div>
  );
}
