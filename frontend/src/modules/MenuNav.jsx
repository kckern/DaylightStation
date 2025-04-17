import React, { useEffect, useState, useRef, useCallback } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import './MenuNav.scss';

const menuTime = 3000;

export default function MenuNav({ setMenu, menu, setQueue }) {
  const [menuItems, setMenuItems] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(menuTime);
  const menuRef = useRef(null);

  // UseCallback so that the function isn’t re-created on every render.
  const selectItem = useCallback(() => {
    if (!menuItems || menuItems.length === 0)  return false;
    const { key: selectedKey, type: selectedType } = menuItems[selectedIndex] || {};
    if (selectedKey && selectedType) {
        setMenu(false);
        setQueue((prevQueue) => [...prevQueue, { key: selectedType, value: selectedKey }]);
    }
  }, [selectedIndex]);

  // Fetch the menu items
  useEffect(() => {
    DaylightAPI('data/videomenu')
      .then((data) => {
        setMenuItems(data.filter((item) => (new RegExp(menu, 'i')).test(item.menu)));
      })
      .catch((err) => {
        console.error('Error fetching menu items', err);
      });
  }, []);

  // Only start the countdown (setInterval) after menuItems is loaded
  useEffect(() => {
    // If there’s no data yet, do nothing
    if (!menuItems) return;

    const intervalId = setInterval(() => {
      setTimeLeft((prevTimeLeft) => {
        if (prevTimeLeft <= 0) {
          clearInterval(intervalId);
          selectItem();
          return 0; // keep time at 0
        }
        return prevTimeLeft - 10;
      });
    }, 10);

    return () => clearInterval(intervalId);
  }, [menuItems, selectItem]);

  // Keydown listener to change selected index
  useEffect(() => {
    if (!menuItems) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenu(false);
        return;
      }
      // Example: Each key press moves to next item
      setSelectedIndex((prevIndex) => (prevIndex + 1) % menuItems.length);
      // Reset the timer
      setTimeLeft(menuTime);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuItems, setMenu]);

  // Scroll logic to keep the active item in view
  useEffect(() => {
    if (!menuItems) return;
    if (menuRef.current) {
      const menuDiv = menuRef.current;
      const selectedElem = menuDiv.querySelector('.menu-item.active');
      if (selectedElem) {
        menuDiv.scrollTo({
          top: selectedElem.offsetTop - menuDiv.clientHeight / 2 + selectedElem.clientHeight / 2,
          behavior: 'smooth',
        });
      }
    }
  }, [selectedIndex, menuItems]);

  if (!menuItems) return null;

  return (
    <div className="menunav">
      <h2>{menu}</h2>
      
      <ProgressTimeoutBar timeLeft={timeLeft} />

      <div className="menu-items" ref={menuRef}>
        {menuItems.map(({ label, menu, uid, key }, i) => (
          <div
            key={uid}
            className={`menu-item ${selectedIndex === i ? 'active' : ''}`}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressTimeoutBar({ timeLeft }) {
  return (
    <div className="progress-bar">
      <div
        className="progress"
        style={{ width: `${(1 - timeLeft / menuTime) * 100}%` }}
      />
      <span className="progress-text" />
    </div>
  );
}