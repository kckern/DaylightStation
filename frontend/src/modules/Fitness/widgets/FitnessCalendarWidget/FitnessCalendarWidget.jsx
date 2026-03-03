import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import './FitnessCalendarWidget.scss';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Map a normalized t (0–1) to a color on an orange gradient.
 * Light orange (#fed8a0) → Strava orange (#fc4c02)
 */
function sufferColor(t) {
  const clamped = Math.max(0, Math.min(t, 1));
  const r = Math.round(254 + (252 - 254) * clamped);
  const g = Math.round(216 + (76 - 216) * clamped);
  const b = Math.round(160 + (2 - 160) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Format a date string as "Mon, Jan 5" for tooltip display.
 */
function formatTooltipDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * FitnessCalendarWidget — GitHub-style 7×10 activity heatmap.
 * Rows = Mon–Sun, columns = weeks (most recent on right).
 * Cell color encodes suffer score; click a day to scroll the sessions list.
 */
export default function FitnessCalendarWidget() {
  const rawSessions = useScreenData('sessions');
  const { setScrollToDate, selectedSessionId } = useFitnessScreen();

  const sessions = rawSessions?.sessions || [];

  // Build date → { count, totalSufferScore } map
  const dateMap = useMemo(() => {
    const map = new Map();
    for (const s of sessions) {
      if (!s.date) continue;
      const ss = s.totalSufferScore ?? null;
      const dur = s.durationMs || 0;
      const existing = map.get(s.date);
      if (existing) {
        existing.count += 1;
        existing.totalMs += dur;
        if (ss != null && (existing.totalSufferScore === null || ss > existing.totalSufferScore)) {
          existing.totalSufferScore = ss;
        }
      } else {
        map.set(s.date, { count: 1, totalSufferScore: ss, totalMs: dur });
      }
    }
    return map;
  }, [sessions]);

  // Build sorted suffer scores for decile-based coloring.
  // Rank each day's suffer score against all others so outlier spikes
  // don't flatten everything else to the bottom of the gradient.
  const sufferRankMap = useMemo(() => {
    const scores = [];
    for (const [date, d] of dateMap.entries()) {
      if (d.totalSufferScore != null && d.totalSufferScore > 0) {
        scores.push({ date, score: d.totalSufferScore });
      }
    }
    if (scores.length === 0) return new Map();
    scores.sort((a, b) => a.score - b.score);
    const rank = new Map();
    for (let i = 0; i < scores.length; i++) {
      // Percentile rank 0–1
      const t = scores.length > 1 ? i / (scores.length - 1) : 0.5;
      rank.set(scores[i].date, t);
    }
    return rank;
  }, [dateMap]);

  // Derive selected date from selectedSessionId (format: YYYYMMDD...)
  const selectedDate = useMemo(() => {
    if (!selectedSessionId || selectedSessionId.length < 8) return null;
    return `${selectedSessionId.slice(0, 4)}-${selectedSessionId.slice(4, 6)}-${selectedSessionId.slice(6, 8)}`;
  }, [selectedSessionId]);

  // Generate the 7×13 grid of dates (91 cells)
  // Most recent week on right, Monday = row 0
  const { cells, todayStr, monthLabels } = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Find the Monday of the current week (ISO: Mon=1)
    const dayOfWeek = now.getDay(); // 0=Sun
    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 1=Mon..7=Sun
    const mondayOffset = isoDay - 1;

    // The grid ends at the current week (rightmost column)
    // Start date = Monday of (current week - 12 weeks)
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - 12 * 7);

    const result = [];
    for (let col = 0; col < 13; col++) {
      for (let row = 0; row < 7; row++) {
        const cellDate = new Date(startDate);
        cellDate.setDate(startDate.getDate() + col * 7 + row);
        const dateStr = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        result.push({ dateStr, col, row });
      }
    }

    // Build month labels: find which column each month starts in
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = new Array(13).fill('');
    for (let col = 0; col < 13; col++) {
      // Check the Monday of this column
      const colDate = new Date(startDate);
      colDate.setDate(startDate.getDate() + col * 7);
      const month = colDate.getMonth();
      // Show label on the first column where this month appears
      const prevColDate = col > 0 ? new Date(startDate.getTime() + (col - 1) * 7 * 86400000) : null;
      if (col === 0 || (prevColDate && prevColDate.getMonth() !== month)) {
        months[col] = MONTH_NAMES[month];
      }
    }

    return { cells: result, todayStr: today, monthLabels: months };
  }, []);

  const handleCellClick = (dateStr) => {
    setScrollToDate(dateStr);
  };

  return (
    <div className="fitness-calendar">
      <div className="fitness-calendar__labels">
        {DAY_LABELS.map((label, i) => (
          <div key={i} className="fitness-calendar__label">{label}</div>
        ))}
      </div>
      <div className="fitness-calendar__body">
        <div className="fitness-calendar__months">
          {monthLabels.map((label, i) => (
            <div key={i} className="fitness-calendar__month-label">{label}</div>
          ))}
        </div>
        <div className="fitness-calendar__grid">
        {cells.map(({ dateStr, col, row }) => {
          const isFuture = dateStr > todayStr;
          const data = dateMap.get(dateStr);
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const hasSession = !!data;

          let bgColor;
          if (isFuture) {
            bgColor = 'transparent';
          } else if (!hasSession) {
            bgColor = '#888';
          } else if (sufferRankMap.has(dateStr)) {
            const t = sufferRankMap.get(dateStr);
            bgColor = sufferColor(Math.max(t, 0.15));
          } else {
            bgColor = '#FFF';
          }

          const classNames = ['fitness-calendar__cell'];
          if (isFuture) classNames.push('fitness-calendar__cell--future');
          if (isToday) classNames.push('fitness-calendar__cell--today');
          if (isSelected) classNames.push('fitness-calendar__cell--selected');
          if (hasSession && !isFuture) classNames.push('fitness-calendar__cell--active');

          const tooltip = isFuture ? undefined
            : hasSession
              ? `${formatTooltipDate(dateStr)}: ${data.count} session${data.count > 1 ? 's' : ''}${data.totalSufferScore > 0 ? ` (suffer: ${data.totalSufferScore})` : ''}`
              : formatTooltipDate(dateStr);

          const totalMin = hasSession && data.totalMs > 0 ? Math.round(data.totalMs / 60000) : null;

          return (
            <div
              key={`${col}-${row}`}
              className={classNames.join(' ')}
              style={{ backgroundColor: bgColor }}
              title={tooltip}
              onPointerDown={hasSession && !isFuture ? () => handleCellClick(dateStr) : undefined}
            >
              {totalMin != null && <span className="fitness-calendar__mins">{totalMin}m</span>}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
