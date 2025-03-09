// Upcoming.jsx
import { useState, useEffect } from 'react';
import { DaylightAPI } from "../lib/api.mjs";
import './Upcoming.scss';

export default function Upcoming() {
  const cycleTimeMs = 6000;
  const animationDuration = 1000; // milliseconds for each animation

  // State variables
  const [mainIndex, setMainIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(0);
  const [listItems, setListItems] = useState([]);
  const [animatingList, setAnimatingList] = useState(false);

  // Function to reload data from the API
  const reloadData = () => {
    DaylightAPI("/data/calendar").then(events => {            
      setListItems(events.map(event => ({
        id: event.id, // Ensure each event has a unique ID
        title: event.summary,
        description: event.description,
        time: event.start
      })));
    });
  };

  // Initial data load and periodic reload every 5 minutes
  useEffect(() => {
    reloadData();
    const loadInterval = setInterval(reloadData, 300000); // 5 minutes
    return () => clearInterval(loadInterval);
  }, []);

  // Interval to trigger transitions
  useEffect(() => {
    if (listItems.length === 0) return; // Do nothing if no items

    const interval = setInterval(() => {
      // Start ListPanel animation
      setAnimatingList(true);

      // Update indices
      setPreviousIndex(mainIndex);
      setMainIndex((prevIndex) => (prevIndex + 1) % listItems.length);

      // Reset animation flag after duration
      setTimeout(() => {
        setAnimatingList(false);
        //append the most recent item to the end of the list
        setListItems((prevList) => {
          const newItem = prevList[mainIndex];
          return [...prevList, newItem];
        });
      }, animationDuration);
    }, cycleTimeMs);

    return () => clearInterval(interval);
  }, [cycleTimeMs, animationDuration, listItems.length, mainIndex]);

  return (
    <div className="upcoming">
      <MainPanel items={listItems} index={mainIndex} />
      <ListPanel 
        items={listItems} 
        animate={animatingList} 
        displayIndex={animatingList ? previousIndex : mainIndex} 
      />
    </div>
  );
}

// MainPanel Component
function MainPanel({ items, index }) {
  if (items.length === 0) return null; // Handle empty state

  return (
    <div className="main-panel">
      <div
        className="main-panel-items"
        style={{
          transform: `translateX(-${index * 100}%)`,
          transition: 'transform 1s ease-in-out',
        }}
      >
        {items.map((item) => (
          <div className="main-panel-item" key={item.id} style={{ width: '100%' }}>
            <h2>{item.title}</h2>
            <p>{item.time}</p>
            <p>{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ListPanel Component
function ListPanel({ items, animate, displayIndex }) {
  if (items.length === 0) return null; // Handle empty state

  // Determine items to display based on displayIndex
  const displayItems = items.slice(displayIndex + 1)

  return (
    <div className="list-panel">
      <div className={`list-panel-items ${animate ? 'animating' : ''}`}>
        {displayItems.map((item, i) => {
          let className = 'list-panel-item';
          if (animate) {
            if (i === 0) {
              className += ' slide-out';
            } else {
              className += ' slide-up';
            }
          } else {
            className += ' noslide';
          }
          return (
            <div className={className} key={item.id}>
              <h2>{item.title}</h2>
            </div>
          );
        })}
      </div>
    </div>
  );
}