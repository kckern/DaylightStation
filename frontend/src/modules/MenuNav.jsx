import React, {
  useEffect,
  useState,
  useRef,
  useCallback
} from 'react';

// We’ll import the same utility used in TVMenu for building image paths.
import { DaylightAPI, DaylightMediaPath } from '../lib/api.mjs';

// Reuse these sub-components from your project, as in TVMenu.jsx
import Player from './Player';
import TVMenu from './TVMenu';
import AppContainer from './AppContainer';

import './MenuNav.scss';

const MENU_TIMEOUT = 3000;

export default function MenuNav({ setMenu, menu, clear }) {
  const [menuItems, setMenuItems] = useState([]);
  const [menuMeta, setMenuMeta] = useState({ title: 'Loading...' });
  const [loaded, setLoaded] = useState(false);

  // Which item in the list is highlighted
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Countdown; if this hits 0, we auto-trigger the current item
  const [timeLeft, setTimeLeft] = useState(MENU_TIMEOUT);

  // If we trigger an item (Player, TVMenu, etc.), store it here
  const [currentContent, setCurrentContent] = useState(null);

  const intervalRef = useRef(null);
  const menuRef = useRef(null);

  // --------------------------------------------------------------------------
  // escapeHandler: Pressing "Escape" or something that closes content
  // --------------------------------------------------------------------------
  const escapeHandler = useCallback(() => {
    return  clear();
    if (currentContent) {
      // If currently inside nested content, close it and reset timeout
      setCurrentContent(null);
      setTimeLeft(MENU_TIMEOUT);
      return;
    }
    // Otherwise, if no nested content, call the "clear" prop to go up one level
    if (clear) {
      setMenu(false);
      clear();
    }
  }, [currentContent, clear]);

  // --------------------------------------------------------------------------
  // handleSelection: Similar to TVMenu’s approach
  // invokes the appropriate sub-component or action
  // --------------------------------------------------------------------------
  const handleSelection = useCallback(
    (selection) => {
      if (!selection || !selection.label) {
        return clear();
      }

      // Sub-component mapping from property to a React element
      const closeContent = () => {
        setCurrentContent(null);
        setTimeLeft(MENU_TIMEOUT); // reset the timer when content is closed
      };
      const props = { ...selection, clear: closeContent };

      const options = {
        play:     <Player {...props} />,
        queue:    <Player {...props} />,
        playlist: <Player {...props} />,
        list:     <TVMenu {...props} />,
        menu:     <TVMenu {...props} />,
        open:     <AppContainer {...props} />
      };

      // Check which property is present in the selection, pick the first match
      const selectionKeys = Object.keys(selection);
      const availableKeys = Object.keys(options);
      const firstMatch = selectionKeys.find((key) =>
        availableKeys.includes(key)
      );

      if (firstMatch) {
        setCurrentContent(options[firstMatch]);
      } else {
        alert(
          `No valid action found for selected item (${selectionKeys}).\n` +
          `Available actions: ${availableKeys.join(', ')}`
        );
      }
    },
    []
  );

  // --------------------------------------------------------------------------
  // Fetch menu items and store them + any metadata (title, image, etc.)
  // --------------------------------------------------------------------------
  useEffect(() => {
    async function fetchMenuContent() {
      if (!menu) {
        setLoaded(true);
        return;
      }
      try {
        const result = await DaylightAPI(`data/list/${menu}`);
        // The fetched data might include { title, image, kind, items }
        const {
          label = menu.toUpperCase(),
          image,
          items = []
        } = result || {};

        setMenuMeta({ label, image });
        setMenuItems(items);
      } catch (err) {
        console.error('Error fetching menu items', err);
      } finally {
        setLoaded(true);
      }
    }
    fetchMenuContent();
  }, [menu]);

  // --------------------------------------------------------------------------
  // Countdown logic: decrement timeLeft until 0, then auto-select
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded || currentContent) return;

    // Clear old intervals before setting a new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          // Time’s up → auto-trigger
          handleSelection(menuItems[selectedIndex]);
          return 0;
        }
        return prev - 10;
      });
    }, 10);

    return () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [loaded, selectedIndex, handleSelection, menuItems, currentContent]);

  // --------------------------------------------------------------------------
  // Keydown listener:
  //   Escape → escapeHandler
  //   Anything else → move to next item, reset timer
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!menuItems.length) return;

    const handleKeyDown = (event) => {
      switch (event.key) {
        case "1": // TODO, ensure this key is provided in the config
        case 'Escape':
          event.preventDefault();
          escapeHandler();
          break;
        case 'Enter':
          event.preventDefault();
          handleSelection(menuItems[selectedIndex]);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          // Move up in the list
          setSelectedIndex((prevIndex) =>
            (prevIndex - 1 + menuItems.length) % menuItems.length
          );
          setTimeLeft(MENU_TIMEOUT); // reset the timer
          break;
        default:
          // Any other key cycles to the next item
          setSelectedIndex((prevIndex) => (prevIndex + 1) % menuItems.length);
          setTimeLeft(MENU_TIMEOUT); // reset the timer
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuItems, escapeHandler]);

  // --------------------------------------------------------------------------
  // Scroll the selected item into view, just like in TVMenu
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!menuRef.current || !menuItems.length) return;
    const menuDiv = menuRef.current;
    const selectedElem = menuDiv.querySelector('.menu-item.active');
    if (!selectedElem) return;

    menuDiv.scrollTo({
      top:
        selectedElem.offsetTop
        - menuDiv.clientHeight / 2
        + selectedElem.clientHeight / 2,
      behavior: 'smooth'
    });
  }, [selectedIndex, menuItems]);

  // If we have a nested component (Player, TVMenu, AppContainer), render it exclusively
  if (currentContent) {
    return currentContent;
  }

  // If data isn’t loaded or there are no items, show nothing
  if (!loaded || !menuItems.length) {
    return null;
  }

  return (
    <div className="menunav">
      {/* Display a header with the menu’s title (or fallback) */}
      <h2>{menuMeta.title || menuMeta.label || menu}</h2>

      {/* Show progress bar for how long until the current item auto-activates */}
      <ProgressTimeoutBar timeLeft={timeLeft} />

      <div className="menu-items" ref={menuRef}>
        {menuItems.map((item, i) => {
          // If there's a Plex key in the first recognized action, generate an image URL
          const { plex } = item.play || item.queue || item.list || item.open || {};
          if (plex) {
            // If plex is an array or a string, pick the first item to build an image path
            const plexId = Array.isArray(plex) ? plex[0] : plex;
            item.image = DaylightMediaPath(`/media/plex/img/${plexId}`);
          }

          return (
            <div
              key={item.uid || i}
              className={`menu-item ${selectedIndex === i ? 'active' : ''}`}
            >
              <MenuNavIMG img={item.image} label={item.label} />
              <div className="menu-item-label">
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// A component to display item images, very similar to MenuIMG in TVMenu
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
    return null; // If no image, don’t render an img element
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
// A progress bar that shows how much time remains before the current item is selected
// --------------------------------------------------------------------------
function ProgressTimeoutBar({ timeLeft }) {
  return (
    <div className="progress-bar">
      <div
        className="progress"
        style={{ width: `${(1 - timeLeft / MENU_TIMEOUT) * 100}%` }}
      />
      <span className="progress-text">
        {/* Show time in seconds, e.g. "2.9s" */}
      </span>
    </div>
  );
}
