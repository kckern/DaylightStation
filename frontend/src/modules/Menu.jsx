import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { DaylightAPI, DaylightMediaPath } from "../lib/api.mjs";
import "./Menu.scss";

// -----------------------------------------------------------------------------
// Main exported components
// -----------------------------------------------------------------------------
export function TVMenu({ list, onSelect, onEscape }) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list);
  const containerRef = useRef(null);

  if (!loaded) return null;

  return (
    <div className="menu-items-container" ref={containerRef}>
      <h2>{menuMeta.title || menuMeta.label}</h2>
      <MenuItems
        items={menuItems}
        columns={5}
        onSelect={onSelect}
        onClose={onEscape}
        containerRef={containerRef}
      />
    </div>
  );
}

export function KeypadMenu({
  list,
  onSelection,
  onClose,
  onMenuState,
  MENU_TIMEOUT = 3000
}) {
  const { menuItems, menuMeta, loaded } = useFetchMenuData(list);
  const containerRef = useRef(null);

  useEffect(() => {
    onMenuState?.(true);
    return () => onMenuState?.(false);
  }, [onMenuState]);

  if (!loaded || !menuItems.length) return null;

  return (
    <div className="menu-items-container" ref={containerRef}>
      <h2>{menuMeta.title || menuMeta.label || "Menu"}</h2>
      <MenuItems
        items={menuItems}
        columns={5}
        onSelect={onSelection}
        onClose={onClose}
        MENU_TIMEOUT={MENU_TIMEOUT}
        containerRef={containerRef}
      />
    </div>
  );
}


// -----------------------------------------------------------------------------
// 1) A stable custom hook for a countdown timer
// -----------------------------------------------------------------------------
function useProgressTimeout(timeout = 0,  onTimeout, interval =15) {
  const [timeLeft, setTimeLeft] = useState(timeout);
  const timerRef = useRef(null);

  // Store the onTimeout callback in a ref so the effect doesn’t re-run
  const callbackRef = useRef(onTimeout);
  useEffect(() => {
    callbackRef.current = onTimeout;
  }, [onTimeout]);

  // Only (re)initialize when timeout or interval changes
  useEffect(() => {
    // If no (or zero) timeout, do nothing
    if (!timeout || timeout <= 0) {
      setTimeLeft(0);
      return;
    }

    // Reset time left
    setTimeLeft(timeout);

    // Create the interval timer
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const newVal = prev - interval;
        if (newVal <= 0) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          // Call the stored callback
          callbackRef.current?.();
          return 0;
        }
        return newVal;
      });
    }, interval);

    // Cleanup when unmounting or changing dependencies
    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [timeout, interval]);

  // Resets only the “timeLeft” to the original “timeout” without re‐creating the timer
  const resetTime = useCallback(() => {
    if (timerRef.current) {
      setTimeLeft(timeout);
    }
  }, [timeout]);

  return { timeLeft, resetTime };
}


// -----------------------------------------------------------------------------
// Hook to fetch menu data
// -----------------------------------------------------------------------------
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

    async function fetchData(target) {
      if (!target) {
        return { title: "No Menu", image: "", kind: "default", items: [] };
      }
      const { title, image, kind, items } = await DaylightAPI(`data/list/${target}`);
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
      if (Array.isArray(input?.items)) {
        const { items, ...rest } = input;
        setMenuItems(items);
        setMenuMeta(rest);
        setLoaded(true);
        return;
      }
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
      if (typeof input === "object") {
        const { menu, list, plex } = input;
        const param = menu || list || plex;
        if (param) {
          const data = await fetchData(param);
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

// -----------------------------------------------------------------------------
// MenuIMG: a helper component to display the image and detect orientation
// -----------------------------------------------------------------------------
function MenuIMG({ img, label }) {
  const [orientation, setOrientation] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const ratio = naturalWidth / naturalHeight;
    let newOrientation = "square";
    if (ratio > 1) newOrientation = "landscape";
    else if (ratio < 1) newOrientation = "portrait";
    setOrientation(newOrientation);
    setLoading(false);
  };

  if (!img) return null;

  return (
    <div className={`menu-item-img ${loading ? "loading" : ""} ${orientation}`}>
      <img
        src={img}
        alt={label}
        onLoad={handleImageLoad}
        style={{ display: loading ? "none" : "block" }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// MenuItems: renders the list of items, handles arrow keys & optional timeout
// -----------------------------------------------------------------------------
function MenuItems({
  items = [],
  columns = 1,
  onSelect,
  onClose,
  MENU_TIMEOUT = 0,
  containerRef,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keyboard navigation
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
          setSelectedIndex((prev) => (prev - columns + items.length) % items.length);
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + columns) % items.length);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
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

  // Attach/detach the global listener
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Our custom countdown Hook
  const { timeLeft, resetTime } = useProgressTimeout(MENU_TIMEOUT, () => {
    onSelect?.(items[selectedIndex]);
  });

  // Reset when the selected item changes
  useEffect(() => {
    if (MENU_TIMEOUT > 0 && items.length) {
      resetTime();
    }
  }, [selectedIndex, items, MENU_TIMEOUT, resetTime]);

  // Scroll the container so the active item remains in view
  useEffect(() => {
    if (!containerRef?.current || !items.length) return;
    const containerEl = containerRef.current;
    const containerHeight = containerEl.offsetHeight;
    const selectedElem = containerEl.querySelector(".menu-items")?.children[selectedIndex];
    if (!selectedElem) return;

    const selectedHeight = selectedElem.offsetHeight;
    const selectedTop = selectedElem.offsetTop;
    const centerTarget = selectedTop - containerHeight / 2 + selectedHeight / 2;
    const maxScroll = containerEl.scrollHeight - containerHeight;
    const newTranslateY = Math.max(0, Math.min(maxScroll, centerTarget));
    containerEl.style.transform = `translateY(${-newTranslateY}px)`;
  }, [selectedIndex, items, containerRef]);

  // A small child component for the progress bar
  const ProgressTimeoutBar = ({ timeLeft, totalTime }) => {
    if (totalTime <= 0) return null;
    const percentage = 100 - (timeLeft / totalTime) * 100;
    return (
      <div className="progress-bar">
        <div className="progress" style={{ width: `${percentage}%` }} />
      </div>
    );
  };

  return (
      <div className={`menu-items count_${items.length}`} >
        {items.map((item, index) => {
          const { plex } = item?.play || item?.queue || item?.list || item?.open || {};
          const isActive = index === selectedIndex;
          let image = item.image;
          if (plex) {
            const val = Array.isArray(plex) ? plex[0] : plex;
            image = DaylightMediaPath(`/media/plex/img/${val}`);
          }
          return (
            <div
              key={`${index}-${item.label}`}
              className={`menu-item ${item.type || ""} ${
                index === selectedIndex ? "active" : ""
              }`}
            >
              {!!MENU_TIMEOUT && !!isActive && <ProgressTimeoutBar timeLeft={timeLeft} totalTime={MENU_TIMEOUT} />}
              <MenuIMG img={image} label={item.label} />
              <h3 className="menu-item-label">{item.label}</h3>
            </div>
          );
        })}
      </div>
  );
}