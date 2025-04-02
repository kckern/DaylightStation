import React, { useState, useEffect, useRef } from 'react';
import './TVMenu.scss';
import { DaylightAPI } from '../lib/api.mjs';

const TVMenu = ({ menuList, setSelection, appRef }) => {
  /**
   * Default buttons A-O if no menuList is provided.
   * Each button object has a title to display, a key to use for selection,
   * and an optional background image.
   */
  const defaultButtonLabels = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));



  const defaultButtons = defaultButtonLabels.map((label) => ({
    title: label,
    key: label,
    img: ''
  }));

  // State for the currently displayed buttons and which one is selected
  const [buttons, setButtons] = useState(defaultButtons);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuMeta, setMenuMeta] = useState({});
  // Grid layout definitions
  const COL_COUNT = 5;
  const ROW_COUNT = buttons.length / COL_COUNT;
  const TOTAL_ITEMS = ROW_COUNT * COL_COUNT;

  //scroll to the selected button
  const menuRef = useRef(null);
  useEffect(() => {
    if (menuRef.current) {
      const selectedButton = menuRef.current.querySelector('.highlighted');
      const scrollableParent = appRef.current;
      if (selectedButton && scrollableParent) {
        const buttonRect = selectedButton.getBoundingClientRect();
        const parentRect = scrollableParent.getBoundingClientRect();

        // Calculate the position to scroll to, centering the selected button
        const scrollTop =
          buttonRect.top - parentRect.top + scrollableParent.scrollTop - parentRect.height / 2 + buttonRect.height / 2;
        scrollableParent.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);
 


  /**
   * Fetch the button data if menuList is provided,
   * otherwise default buttons (A-O) remain.
   */
  useEffect(() => {
    if (!menuList) return ()=> {};

    const fetchData = async () => {
      try {
        if(!menuList || menuList?.length === 0) {
          setMenuMeta({ title: 'TV Menu', img: '', type: 'default' });
          setButtons(defaultButtons);
          setSelectedIndex(0);
          return ;
        }
        const { plex } = menuList;
        if (!plex) return;
        const { list, title, img } = await DaylightAPI(`media/plex/list/${plex}`);
        const newButtons = list.map((item) => ({
          title: item.title,
          key: item.key ?? item.title, // Fallback to title if key is missing
          img: item.img ?? ''          // Fallback to empty string if img is missing
        }));
        setMenuMeta({ title, img, type: 'plex' });
        setButtons(newButtons);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Error fetching TV menu data:', error);
      }
    };

    fetchData();
  }, [menuList]);

  /**
   * Handle keyboard navigation and selection.
   */
  const handleKeyDown = (e) => {
    switch (e.key) {
      case 'Enter':
        if(menuMeta.type === 'plex') return handleSelection(buttons[selectedIndex].key);
        setSelection(buttons[selectedIndex].key);
        break;
      case 'ArrowUp':
        setSelectedIndex((prev) => (prev - COL_COUNT + TOTAL_ITEMS) % TOTAL_ITEMS);
        break;
      case 'ArrowDown':
        setSelectedIndex((prev) => (prev + COL_COUNT) % TOTAL_ITEMS);
        break;
      case 'ArrowLeft':
        setSelectedIndex((prev) => (prev - 1 + TOTAL_ITEMS) % TOTAL_ITEMS);
        break;
      case 'ArrowRight':
        setSelectedIndex((prev) => (prev + 1) % TOTAL_ITEMS);
        break;
      case 'Escape':
        setSelection(null);
        break;
      default:
        break;
    }
  };

  /**
   * Attach and detach the keyboard listener.
   */
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedIndex, buttons]);

  const handleSelection = (key) => {
    setSelection({plex: key});
  };

  return (
    <div className="tv-menu-container">
      <h2>{menuMeta.title}</h2>
      <div className="tv-menu" ref={menuRef}>
        {buttons.map((button, index) => (
          <div
            key={button.key}
            data-key={button.key}
            className={`menu-button ${selectedIndex === index ? 'highlighted' : ''}`}
          >
            {button.img && <img src={button.img} alt={button.title} className="menu-button-img" />}
            <h3 className="menu-button-title">{button.title}</h3>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TVMenu;