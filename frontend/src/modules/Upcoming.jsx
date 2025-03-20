import { useState, useEffect } from "react";
import { DaylightAPI } from "../lib/api.mjs";
import "./Upcoming.scss";
import moment from "moment";

export default function Upcoming() {
  const cycleTimeMs = 5000;
  const animationDuration = 1000;
  const [listItems, setListItems] = useState([]);
  const [isMoving, setIsMoving] = useState(false);
  const reloadData = () => {
    DaylightAPI("/data/events").then(events => {
      events = [...events.slice(-1), ...events.slice(0, -1)];
      while (events.length < 5) events = [...events, ...events];

      setListItems(
        events.map(event => ({
          ...event,
          title:  event.summary || event.title,
          time:   event.start || null
        }))
      );
    });
  };

  // Initial load + refresh every 5 minutes
  useEffect(() => {
    reloadData();
    const loadInterval = setInterval(reloadData, 1000 * 60 * 3);
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

  // Mon, 1 Jan • 5:00 PM
  const {allday} = item;
  const format = allday ? "dddd, D MMMM" : "dddd, D MMMM • h:mm A";
  const daysInFuture = moment(item.time).diff(moment(), "days");
  const inXDays = daysInFuture > 0 ? daysInFuture === 1 ? "Tomorrow" : `In ${daysInFuture} days` : "";
  const timeLabel = item.type === "todoist" ? "Todo" : moment(item.start).format(format).replace(/:00/g, ""); // Remove ":00" from time
  const titleLabel = item.title;
  const locationLabel = item.domain ||  item.location || null

  const color = item.color || "red"; // Fallback color if not provided

  return (
    <div className={className + ` ${color}`}>
      {!!timeLabel && <h2>{timeLabel}</h2>}
      {!!locationLabel && <h3>{locationLabel}</h3>}
      {!!inXDays && <h4>{inXDays}</h4>}
      {!!titleLabel && <p>{titleLabel}</p>}
    </div>
  );
}

function ListItem({ item, className }) {

  const daysInFuture = moment(item.time).diff(moment(), "days");
  const chipLabel = item.type === "todoist" 
    ? "Todo" 
    : daysInFuture > 10 
    ? moment(item.time).format("D MMM") 
    : daysInFuture > 0 
    ? daysInFuture === 1 
      ? "Tomorrow" 
      : moment(item.time).format("ddd") 
    : "Today";

  return (
    <div className={className + ` list-item ${item.color || "red"}`}>
      <h2>
        <span className="chip">
        {chipLabel}
        </span> 
        {item.title}
      </h2>
    </div>
  );
}
