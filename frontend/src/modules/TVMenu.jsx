import React, { useState, useEffect } from 'react';
import './TVMenu.scss';

const TVMenu = ({ setSelection }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const ROW_COUNT = 3;
  const COL_COUNT = 5;
  const TOTAL_ITEMS = ROW_COUNT * COL_COUNT;

  const buttons = [
    'A', 'B', 'C', 'D',
    'E', 'F', 'G', 'H',
    'I', 'J', 'K', 'L',
    'M', 'N', 'O'
  ];

  const handleKeyDown = (e) => {
    switch (e.key) {
      case 'Enter':
        setSelection(buttons[selectedIndex]);
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

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedIndex]);

  return (
    <div className="tv-menu-container">
      <h2>TV Menu {selectedIndex + 1} / {buttons.length}</h2>
      <div className="tv-menu">
        {buttons.map((button, index) => (
          <div
            key={button}
            onTouchStart={() => setSelection(button)}
            onClick={() => setSelection(button)}
            className={`menu-button ${selectedIndex === index ? 'highlighted' : ''}`}
          >
            {button}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TVMenu;