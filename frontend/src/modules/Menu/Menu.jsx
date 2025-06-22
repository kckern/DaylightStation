import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { DaylightAPI, DaylightMediaPath } from "../../lib/api.mjs";
import "./Menu.scss";
import { LoadingOverlay } from "../Player/Player";

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
    await DaylightAPI("/data/history/_menu_log", { media_key: selectedKey });
  }
};

/**
 * A custom hook to wrap the "onSelect" callback with a logging side-effect.
 */
function useSelectAndLog(onSelectCallback) {
  return useCallback(
    (item) => {
      if (!item || !onSelectCallback) return;
      onSelectCallback(item);
      logMenuSelection(item);
    },
    [onSelectCallback]
  );
}

/**
 * TVMenu: Main menu component.
 */
export function TVMenu({ list, onSelect, onEscape }) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list);
  const containerRef = useRef(null);
  const handleSelect = useSelectAndLog(onSelect);

  if (!loaded) {
    return null;
  }

  return (
    <div className="menu-items-container" ref={containerRef}>
      <h2>{menuMeta.title || menuMeta.label}</h2>
      <MenuItems
        items={menuItems}
        columns={5}
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
    return <LoadingOverlay />;
  }

  return (
    <div className="menu-items-container" ref={containerRef}>
      <h2>{menuMeta.title || menuMeta.label || "Menu"}</h2>
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
function useFetchMenuData(listInput) {
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
      const { title, image, kind, items } = await DaylightAPI(
        `data/list/${target}${config ? `/${config}` : ""}`
      );
      if (canceled) return null;
      return { title, image, kind, items };
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
  }, [listInput]);

  return { menuItems, menuMeta, loaded };
}

/**
 * MenuIMG: A helper component to display the menu image (and its orientation).
 */
function MenuIMG({ img, label }) {
  const [orientation, setOrientation] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const ratio = naturalWidth / naturalHeight;
    const newOrientation =
      ratio > 1 ? "landscape" : ratio < 1 ? "portrait" : "square";

    setOrientation(newOrientation);
    setLoading(false);
  };

  if (!img) return null;

  return (
    <div
      className={`menu-item-img ${loading ? "loading" : ""} ${orientation}`}
    >
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
 */
function MenuItems({
  items = [],
  columns = 1,
  onSelect,
  onClose,
  MENU_TIMEOUT = 0,
  containerRef,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

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
          setSelectedIndex(
            (prev) => (prev - columns + items.length) % items.length
          );
          break;

        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev + columns) % items.length
          );
          break;

        case "ArrowLeft":
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev - 1 + items.length) % items.length
          );
          break;

        case "ArrowRight":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % items.length);
          break;

        case "Escape":
          e.preventDefault();
          onClose?.();
          break;

        default:
          // Move to the next item if it's an alphanumeric key
          if (!e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
            const key = e.key.toLowerCase();
            if (/[a-z0-9]/.test(key)) {
              e.preventDefault();
              setSelectedIndex((prev) => (prev + 1) % items.length);
            }
          }
          break;
      }
    },
    [items, selectedIndex, onSelect, onClose, columns]
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  return (
    <div className={`menu-items count_${items.length}`}>
      {items.map((item, index) => {
        const { plex } = item?.play || item?.queue || item?.list || item?.open || {};
        const isActive = index === selectedIndex;
        let image = item.image;

        // If there's a Plex ID but no image, build one
        if (!item.image && plex) {
          const val = Array.isArray(plex) ? plex[0] : plex;
          image = DaylightMediaPath(`/media/plex/img/${val}`);
        }

        return (
          <div
            key={`${index}-${item.label}`}
            className={`menu-item ${item.type || ""} ${isActive ? "active" : ""}`}
          >
            {!!MENU_TIMEOUT && isActive && (
              <ProgressTimeoutBar timeLeft={timeLeft} totalTime={MENU_TIMEOUT} />
            )}
            <MenuIMG img={image} label={item.label} />
            <h3 className="menu-item-label">{item.label}</h3>
          </div>
        );
      })}
    </div>
  );
}
