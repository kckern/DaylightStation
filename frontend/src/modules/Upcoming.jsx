import { useState, useEffect } from "react";
import { DaylightAPI } from "../lib/api.mjs";
import "./Upcoming.scss";

export default function Upcoming() {
  const cycleTimeMs = 5000;
  const animationDuration = 1000;
  const [listItems, setListItems] = useState([]);
  const [isMoving, setIsMoving] = useState(false);
  const reloadData = () => {
    DaylightAPI("/data/calendar").then(events => {
      events = [...events.slice(-1), ...events.slice(0, -1)];
      while (events.length < 5) events = [...events, ...events];

      setListItems(
        events.map(event => ({
          id: event.id,
          title: event.summary,
          description: event.description,
          time: event.start
        }))
      );
    });
  };

  // Initial load + refresh every 5 minutes
  useEffect(() => {
    reloadData();
    const loadInterval = setInterval(reloadData, 300000); // 5 minutes
    return () => clearInterval(loadInterval);
  }, []);

  useEffect(
    () => {
      const interval = setInterval(() => {
        setIsMoving(true);
        setTimeout(() => {
          setListItems(prev => {
            return [...prev.slice(1), prev[0]];
          });
          setIsMoving(false);
        }, animationDuration);
      }, cycleTimeMs);

      return () => clearInterval(interval);
    },
    [listItems.length, cycleTimeMs, animationDuration]
  );

  return (
    <div className="upcoming">
      <MainPanel items={listItems} isMoving={isMoving} />
      <ListPanel items={listItems} isMoving={isMoving} />
    </div>
  );
}

function MainPanel({ items, isMoving }) {
  const displayItems = items.slice(1);
  return (
    <div className="main-panel">
      <div className={`main-panel-items ${isMoving ? "animating" : ""}`}>
        {displayItems.map((item, idx) => {
          const className = `main-panel-item ${!isMoving
            ? "noslide"
            : idx === 0 ? "slide-out" : "slide-left"}`;
          return <MainItem key={item.id} item={item} className={className} />;
        })}
      </div>
    </div>
  );
}

function ListPanel({ items, isMoving }) {
  const displayItems = items.slice(2);
  return (
    <div className="list-panel">
      <div className={`list-panel-items ${isMoving ? "animating" : ""}`}>
        {displayItems.map((item, i) => {
          const className = `list-panel-item ${!isMoving
            ? "noslide"
            : i === 0 ? "slide-out" : "slide-up"}`;
          return <ListItem key={item.id} item={item} className={className} />;
        })}
      </div>
    </div>
  );
}

function MainItem({ item, className }) {
  return (
    <div className={className}>
      <h2>
        {item.title}
      </h2>
      <p>
        {item.time}
      </p>
      <p>
        {item.description}
      </p>
    </div>
  );
}

function ListItem({ item, className }) {
  return (
    <div className={className}>
      <h2>
        {item.title}
      </h2>
      <p>
        {item.time}
      </p>
      <p>
        {item.description}
      </p>
    </div>
  );
}
