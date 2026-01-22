import { useState, useEffect } from "react";
import { DaylightAPI } from "../../lib/api.mjs";
import "./Upcoming.scss";
import moment from "moment";

// Simple markdown parser for **bold** text
function parseMarkdown(text) {
  if (!text) return text;
  
  const parts = [];
  let lastIndex = 0;
  const regex = /\*\*(.*?)\*\*/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    // Add bold text
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
}

export default function Upcoming() {
  const cycleTimeMs = 5000;
  const animationDuration = 1000;
  const [listItems, setListItems] = useState([]);
  const [isMoving, setIsMoving] = useState(false);
  const reloadData = () => {
    DaylightAPI("/home/events").then(events => {
      // Rotate events and ensure at least 5 items
      events = [...events.slice(-1), ...events.slice(0, -1)];
      while (events.length < 5) events = [...events, ...events];

      // Map API events to desired format
      const itemsFromAPI = events.map(event => ({
      ...event,
      title: event.summary || event.title,
      time: event.start || null
      })).map(event => {
        const daysInFuture = moment(event.time).startOf("day").diff(moment().startOf("day"), "days") || 0;

        if(daysInFuture > 20) return null;
        // Ensure monday is always a future Monday
        let monday = moment().day(1);
        if (moment().isSameOrAfter(monday, "day")) {
          monday = monday.add(7, "days");
        }
        const nextMonday = moment(monday).add(7, "days");

        //is before $monday
        const isNow = !event.time;
        const isThisWeek = moment(event.time).isBefore(monday);
        const isNextWeek = moment(event.time).isBetween(monday, nextMonday, null, "[]");
        const isAfterNextWeek = moment(event.time).isAfter(nextMonday);
        const isToday = daysInFuture === 0;
        const isTomorrow =  daysInFuture === 1;

        const color = isNow ? "red" : isAfterNextWeek ? "grey" : isNextWeek ? "blue" :  isToday ? "orange" : isTomorrow ? "yellow" : isThisWeek ? "green" : "grey";
        // Set color based on the day of the week
        event.color = color;
        event.daysInFuture = daysInFuture;
        return event;
      }).filter(Boolean);



      // Remove old, removed items and add new items
      const items = [
        ...listItems,
        ...itemsFromAPI.filter(newItem => !listItems.some(existingItem => existingItem.id === newItem.id))
      ]
        .filter(item => 
          (item.type === "todoist" || item.type === "clickup") || moment(item.time).isAfter(moment())
        )
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      setListItems(items);
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

  if (listItems.length === 0) {
      return (
        <div className="upcoming">
            <div className="main-panel">
                <div className="main-panel-items">
                    <div className="main-panel-item skeleton-container" style={{padding: '20px'}}>
                        <div className="skeleton text" style={{width: '40%', height: '1.5rem'}}></div>
                        <div className="skeleton text" style={{width: '30%', height: '1.2rem'}}></div>
                        <div className="skeleton text" style={{width: '80%', height: '3rem', marginTop: '1rem'}}></div>
                    </div>
                </div>
            </div>
            <div className="list-panel">
                <div className="list-panel-items">
                    {Array.from({length: 4}).map((_, i) => (
                        <div key={i} className="list-panel-item skeleton-container" style={{display: 'flex', alignItems: 'center', padding: '10px'}}>
                            <div className="skeleton rect" style={{width: '60px', height: '24px', borderRadius: '12px', marginRight: '10px'}}></div>
                            <div className="skeleton text" style={{flex: 1, height: '1.2rem'}}></div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      )
  }

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
  const {allday, daysInFuture} = item;
  const format = allday ? "dddd, D MMMM" : "dddd, D MMMM • h:mm A";
  const timeFormat = allday ? "dddd, D MMMM" : "h:mm A";
  const inXDays = daysInFuture <= 1 ? null : `In ${daysInFuture} days`;
  const timeLabel = ['todoist', 'clickup'].includes(item.type) ? "Todo" : 
  daysInFuture === 1 ? `Tomorrow at ${moment(item.start).format(timeFormat)}` :
  daysInFuture === 0 ? "Today at " + moment(item.start).format(timeFormat) :
  moment(item.start).format(format).replace(/:00/g, ""); // Remove ":00" from time
  let titleLabel = item.title;
  let subTitleLabel = null;

  const parentheticalMatch = titleLabel.match(/^(.*)\s\((.*)\)$/);
  if (parentheticalMatch) {
    titleLabel = parentheticalMatch[1];
    subTitleLabel = parentheticalMatch[2];
  }
  const locationLabel = item.domain ||  item.location || null

  const color = item.color || "grey"; // Fallback color if not provided

  return (
    <div className={className + ` ${color}`}>
      {!!timeLabel && <h2>{timeLabel}</h2>}
      {!!locationLabel && <h3>{locationLabel}</h3>}
      {!!inXDays && <h4>{inXDays}</h4>}
      {!!titleLabel && <p>{parseMarkdown(titleLabel)} {!!subTitleLabel && <span><small
        style={{ opacity: 0.5, fontSize: "2rem", lineHeight: "2rem" }}
      >{parseMarkdown(subTitleLabel)}</small></span>}</p>}
     
    </div>
  );
}


function ListItem({ item, className }) {

  const {daysInFuture} = item;
  const chipLabel = item.type === "todoist" 
    ? "Todo" 
    : item.type === "clickup"
    ? item.status?.toUpperCase() || "Todo"
    : daysInFuture > 10 
    ? moment(item.time).format("D MMM") 
    : daysInFuture === 0 
    ? "Today"
    : daysInFuture === 1
    ? "Tomorrow"
    : `In ${daysInFuture} days`;

  return (
    <div className={className + ` list-item ${item.color || "grey"}`}>
    
        <span className="chip">
        {chipLabel}
        </span> 
        {parseMarkdown(item.title)}
    </div>
  );
}
