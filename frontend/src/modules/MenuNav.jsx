
import React, {
  useEffect,
  useState,
  useRef,
  useCallback
} from 'react';
import { DaylightAPI, DaylightMediaPath } from '../lib/api.mjs';
import './MenuNav.scss';

const MENU_TIMEOUT = 3000;

export default function MenuNav({
  menuId,         // e.g. "music", "podcasts", ...
  onSelection,    // callback when an item is chosen
  onClose,        // callback when user hits Escape or we can’t load
  onMenuState     // boolean state in the parent, e.g. setMenuOpen(...)
}) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuMeta, setMenuMeta] = useState({ title: 'Loading...' });
  const [loaded, setLoaded] = useState(false);

  // Which item in the list is highlighted
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Countdown; if this hits 0, we auto-trigger the current item
  const [timeLeft, setTimeLeft] = useState(MENU_TIMEOUT);

  const intervalRef = useRef(null);
  const menuRef = useRef(null);

  // --------------------------------------------------------------------------
  // fetchMenuData: load from DaylightAPI => data/list/<menuId>
  // --------------------------------------------------------------------------
  useEffect(() => {
    async function fetchMenuData() {
      if (!menuId) {
        setLoaded(true);
        return;
      }
      try {
        const result = await DaylightAPI(`data/list/${menuId}`);
        // The fetched data might include { title, image, kind, items }
        const {
          label = menuId.toUpperCase(),
          image,
          items = []
        } = result || {};

        setMenuMeta({ label, image });
        setMenuItems(items);
        if (onMenuState) {
          onMenuState(true); // Mark the menu as “open”
        }
      } catch (err) {
        console.error('Error fetching menu items:', err);
        onClose && onClose(); // If we fail to fetch, just close
      } finally {
        setLoaded(true);
      }
    }
    fetchMenuData();

    // Cleanup on unmount
    return () => {
      if (onMenuState) {
        onMenuState(false);
      }
    };
  }, [menuId, onClose, onMenuState]);

  // --------------------------------------------------------------------------
  // Countdown logic: Decrement timeLeft until 0, then auto-select
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded || !menuItems.length) return;

    // Clear old intervals before setting a new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const newVal = prev - 10;
        if (newVal <= 0) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          // Time’s up → auto-trigger the current item
          handleSelection(menuItems[selectedIndex]);
          return 0;
        }
        return newVal;
      });
    }, 10);

    return () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [loaded, menuItems, selectedIndex]);

  // --------------------------------------------------------------------------
  // handleSelection: call onSelection(...) up to the parent
  // --------------------------------------------------------------------------
  const handleSelection = useCallback(
    (choice) => {
      onSelection && onSelection(choice);
    },
    [onSelection]
  );

  // --------------------------------------------------------------------------
  // Keydown listener:
  //   Escape → onClose
  //   Enter → handleSelection
  //   ArrowUp/Down → move highlight
  //   Anything else → also cycle highlight
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!menuItems.length) return;

    const handleKeyDown = (event) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose && onClose();
          break;
        case 'Enter':
          event.preventDefault();
          handleSelection(menuItems[selectedIndex]);
          break;
        case 'ArrowUp':
          setSelectedIndex((prevIndex) =>
            (prevIndex - 1 + menuItems.length) % menuItems.length
          );
          setTimeLeft(MENU_TIMEOUT); // reset the timer
          break;
        case 'ArrowDown':
          setSelectedIndex((prevIndex) =>
            (prevIndex + 1) % menuItems.length
          );
          setTimeLeft(MENU_TIMEOUT);
          break;
        default:
          // Any other key cycles to the next
          setSelectedIndex((prevIndex) => (prevIndex + 1) % menuItems.length);
          setTimeLeft(MENU_TIMEOUT);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuItems, onClose, handleSelection, selectedIndex]);

  // --------------------------------------------------------------------------
  // Scroll the selected item into view
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!menuRef.current || !menuItems.length) return;
    const container = menuRef.current;
    const selectedElem = container.querySelector('.menu-item.active');
    if (!selectedElem) return;

    container.scrollTo({
      top:
        selectedElem.offsetTop
        - container.clientHeight / 2
        + selectedElem.clientHeight / 2,
      behavior: 'smooth'
    });
  }, [selectedIndex, menuItems]);

  // If not loaded or no items, show nothing. Or you could show an error.
  if (!loaded || !menuItems.length) {
    return null;
  }

  // RENDER: show the menu, plus a progress bar
  return (
    <div className="menunav">
      <h2>{menuMeta.title || menuMeta.label || menuId}</h2>

      <ProgressTimeoutBar timeLeft={timeLeft} />

      <div className="menu-items" ref={menuRef}>
        {menuItems.map((item, i) => {
          // If there's a Plex key in the first recognized action, generate an image URL
          const { plex } = item.play || item.queue || item.list || item.open || {};
          if (plex) {
            const plexId = Array.isArray(plex) ? plex[0] : plex;
            item.image = DaylightMediaPath(`/media/plex/img/${plexId}`);
          }

          return (
            <div
              key={item.uid || i}
              className={`menu-item ${selectedIndex === i ? 'active' : ''}`}
            >
              <MenuNavIMG img={item.image} label={item.label} />
              <div className="menu-item-label">{item.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Small helper component to display item images.
// --------------------------------------------------------------------------
function MenuNavIMG({ img, label }) {
  const [orientation, setOrientation] = useState(null);
  const [loading, setLoading] = useState(!!img);

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    const ratio = naturalWidth / naturalHeight;
    const newOrientation =
      ratio === 1 ? 'square' : ratio > 1 ? 'landscape' : 'portrait';
    setOrientation(newOrientation);
    setLoading(false);
  };

  if (!img) {
    return null;
  }

  return (
    <div
      className={`menu-nav-img ${loading ? 'loading' : ''} ${orientation || ''}`}
    >
      <img
        src={img}
        alt={label}
        onLoad={handleImageLoad}
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// A progress bar that shows how much time remains before auto-select
// --------------------------------------------------------------------------
function ProgressTimeoutBar({ timeLeft }) {
  return (
    <div className="progress-bar">
      <div
        className="progress"
        style={{ width: `${(1 - timeLeft / MENU_TIMEOUT) * 100}%` }}
      />
      <span className="progress-text" />
    </div>
  );
}