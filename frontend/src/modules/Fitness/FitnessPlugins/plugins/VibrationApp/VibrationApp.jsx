import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import './VibrationApp.scss';
import { useFitnessContext } from '../../../../../context/FitnessContext.jsx';
import VIBRATION_CONSTANTS from './constants.js';

const resolveLevel = (intensity = 0, thresholds = VIBRATION_CONSTANTS.DEFAULT_THRESHOLDS) => {
  if (!thresholds) return 'low';
  const { high = 30, medium = 15 } = thresholds;
  if (intensity >= high) return 'high';
  if (intensity >= medium) return 'medium';
  return 'low';
};

const formatAxis = (value) => {
  if (value === null || value === undefined) return '—';
  return Math.round(value * 10) / 10;
};

const resolveDirection = (axes = {}) => {
  const { x = 0, y = 0, z = 0 } = axes;
  const values = [Math.abs(x), Math.abs(y), Math.abs(z)];
  const max = Math.max(...values);
  if (max === 0) return { label: 'Idle', tone: 'neutral' };

  if (max === Math.abs(x)) {
    return x > 0 ? { label: 'Right strike', tone: 'positive' } : { label: 'Left strike', tone: 'positive' };
  }
  if (max === Math.abs(y)) {
    return y > 0 ? { label: 'Upward motion', tone: 'warning' } : { label: 'Downward motion', tone: 'warning' };
  }
  return z > 0 ? { label: 'Forward push', tone: 'info' } : { label: 'Pull back', tone: 'info' };
};

const AxisBar = ({ label, value }) => {
  const clamped = Math.max(-30, Math.min(30, value || 0));
  const percent = (clamped / 30) * 50; // -50 to 50 visual span
  return (
    <div className="axis-bar">
      <span className="axis-bar__label">{label}</span>
      <div className="axis-bar__track">
        <div
          className="axis-bar__fill"
          style={{ '--axis-fill': `${50 + percent}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="axis-bar__value">{formatAxis(value)}</span>
    </div>
  );
};

const TIMESERIES_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const TIMESERIES_SAMPLE_INTERVAL = 250; // sample every 250ms

/**
 * Real-time timeseries chart showing X, Y, Z values over the past 2 minutes.
 * True timeseries: X-axis is fixed 2-minute window, points positioned at actual timestamps.
 */
const AxisTimeseries = ({ sensor }) => {
  const [history, setHistory] = useState([]);
  const [timeWindow, setTimeWindow] = useState({ start: Date.now() - TIMESERIES_WINDOW_MS, end: Date.now() });
  const historyRef = useRef([]);

  useEffect(() => {
    const now = Date.now();
    const { x = 0, y = 0, z = 0 } = sensor.axes || {};
    
    // Add new data point
    historyRef.current.push({ t: now, x, y, z });
    
    // Prune old data beyond 2 minutes
    const cutoff = now - TIMESERIES_WINDOW_MS;
    historyRef.current = historyRef.current.filter(pt => pt.t >= cutoff);
    
    // Update time window to always show last 2 minutes ending at now
    setTimeWindow({ start: cutoff, end: now });
    setHistory([...historyRef.current]);
  }, [sensor.axes?.x, sensor.axes?.y, sensor.axes?.z, sensor.lastEvent]);

  // Update time window periodically even without new data
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTimeWindow({ start: now - TIMESERIES_WINDOW_MS, end: now });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format time for X axis (relative seconds ago)
  const formatTime = (timestamp) => {
    const secsAgo = Math.round((timeWindow.end - timestamp) / 1000);
    return `-${secsAgo}s`;
  };

  // Generate fixed tick values for the X axis (every 30 seconds)
  const generateTicks = () => {
    const ticks = [];
    for (let i = 0; i <= 120; i += 30) {
      ticks.push(timeWindow.end - (i * 1000));
    }
    return ticks.reverse();
  };

  if (history.length < 2) {
    return (
      <div className="axis-timeseries axis-timeseries--empty">
        <span>Collecting data...</span>
      </div>
    );
  }

  return (
    <div className="axis-timeseries">
      <div className="axis-timeseries__header">
        <span className="axis-timeseries__title">2min History</span>
        <div className="axis-timeseries__legend">
          <span className="legend-item legend-item--x">X</span>
          <span className="legend-item legend-item--y">Y</span>
          <span className="legend-item legend-item--z">Z</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={history} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <XAxis 
            dataKey="t"
            type="number"
            domain={[timeWindow.start, timeWindow.end]}
            scale="time"
            ticks={generateTicks()}
            tickFormatter={formatTime}
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.5)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={false}
            allowDataOverflow={false}
          />
          <YAxis 
            domain={[-30, 30]}
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.5)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={false}
            tickCount={7}
          />
          <Tooltip 
            contentStyle={{ 
              background: 'rgba(0,0,0,0.85)', 
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              fontSize: 11
            }}
            labelFormatter={(t) => formatTime(t)}
            formatter={(value, name) => [value?.toFixed(1), name.toUpperCase()]}
          />
          <Line 
            type="monotone" 
            dataKey="x" 
            stroke="#ff6b6b" 
            strokeWidth={1.5}
            dot={{ r: 2, fill: '#ff6b6b', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#ff6b6b' }}
            isAnimationActive={false}
          />
          <Line 
            type="monotone" 
            dataKey="y" 
            stroke="#4ecdc4" 
            strokeWidth={1.5}
            dot={{ r: 2, fill: '#4ecdc4', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#4ecdc4' }}
            isAnimationActive={false}
          />
          <Line 
            type="monotone" 
            dataKey="z" 
            stroke="#ffe66d" 
            strokeWidth={1.5}
            dot={{ r: 2, fill: '#ffe66d', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: '#ffe66d' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const ActivityTimeline = ({ events }) => {
  if (!events.length) return null;
  const recent = events.slice(-14).reverse();
  return (
    <div className="activity-timeline">
      {recent.map((evt) => (
        <div
          key={`${evt.id}-${evt.ts}`}
          className="activity-dot"
          title={`${evt.name || evt.id} • ${Math.round(evt.intensity)}`}
          style={{ '--dot-age': evt.ageRatio }}
        />
      ))}
    </div>
  );
};

const VibrationCard = ({ sensor }) => {
  const level = resolveLevel(sensor.intensity, sensor.thresholds);
  const chipClass = `vibration-chip vibration-chip--${level}`;
  const cardClass = sensor.vibration ? 'vibration-card vibration-card--active' : 'vibration-card';
  const batteryLow = sensor.batteryLow || (typeof sensor.battery === 'number' && sensor.battery < 20);
  const direction = resolveDirection(sensor.axes);
  return (
    <div className={cardClass}>
      <div className="vibration-pulse" aria-hidden="true" />
      <div className="vibration-card__header">
        <div>
          <p className="vibration-card__title">{sensor.name || sensor.id}</p>
          {sensor.type && <p className="vibration-card__type">{sensor.type}</p>}
        </div>
        <div className={chipClass}>{sensor.vibration ? 'Active' : 'Idle'}</div>
      </div>
      <div className="vibration-metrics">
        <div className="vibration-metrics__intensity">
          <strong>Intensity:</strong> {Math.round(sensor.intensity || 0)}
        </div>
        <div className={`direction-chip direction-chip--${direction.tone}`}>{direction.label}</div>
        {sensor.battery !== null && sensor.battery !== undefined && (
          <div className={batteryLow ? 'vibration-battery vibration-battery--low' : 'vibration-battery'}>
            🔋 {Math.round(sensor.battery)}%
          </div>
        )}
        {sensor.linkquality !== null && sensor.linkquality !== undefined && (
          <div className="vibration-battery">📶 {sensor.linkquality}</div>
        )}
      </div>
      <div className="vibration-axes">
        <AxisBar label="X" value={sensor.axes?.x} />
        <AxisBar label="Y" value={sensor.axes?.y} />
        <AxisBar label="Z" value={sensor.axes?.z} />
      </div>
      <AxisTimeseries sensor={sensor} />
    </div>
  );
};

const VibrationApp = () => {
  const { vibrationState = {}, connected } = useFitnessContext();
  const sensors = useMemo(() => Object.values(vibrationState || {}), [vibrationState]);
  const lastSeenRef = useRef({});
  const eventsRef = useRef([]);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!sensors.length) {
      eventsRef.current = [];
      setEvents([]);
      return;
    }
    const now = Date.now();
    let mutated = false;
    const nextEvents = [...eventsRef.current];

    sensors.forEach((sensor) => {
      if (!sensor?.vibration) return;
      const lastSeen = lastSeenRef.current[sensor.id];
      if (lastSeen === sensor.lastEvent) return;
      lastSeenRef.current[sensor.id] = sensor.lastEvent;
      mutated = true;
      nextEvents.push({
        id: sensor.id,
        name: sensor.name,
        ts: sensor.lastEvent || now,
        intensity: sensor.intensity || 0
      });
    });

    if (mutated) {
      const windowMs = 30_000;
      const cutoff = now - windowMs;
      const pruned = nextEvents.filter((evt) => evt.ts >= cutoff);
      const withAges = pruned.map((evt) => ({
        ...evt,
        ageRatio: Math.max(0, Math.min(1, (now - evt.ts) / windowMs))
      }));
      eventsRef.current = withAges;
      setEvents(withAges);
    }
  }, [sensors]);

  if (!connected) {
    return <div className="vibration-app vibration-app__status">Connecting to sensor network...</div>;
  }

  if (!sensors.length) {
    return <div className="vibration-app vibration-app__status">No vibration sensors configured</div>;
  }

  return (
    <div className="vibration-app">
      <div className="vibration-app__header">
        <h3>Vibration Monitor</h3>
        <span>{sensors.length} sensor{ sensors.length === 1 ? '' : 's' }</span>
      </div>
      <ActivityTimeline events={events} />
      <div className="vibration-grid">
        {sensors.map((sensor) => (
          <VibrationCard key={sensor.id} sensor={sensor} />
        ))}
      </div>
    </div>
  );
};

export default VibrationApp;
