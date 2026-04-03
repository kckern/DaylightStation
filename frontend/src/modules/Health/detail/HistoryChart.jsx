import React, { useState, useMemo } from 'react';
import { Group, Button } from '@mantine/core';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const RANGES = [
  { key: '90d', label: '90 Days' },
  { key: '6mo', label: '6 Months' },
  { key: '2yr', label: '2 Years' },
];

function toTimestamp(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + 'T12:00:00Z').getTime();
}

function buildChartData(history, range) {
  let entries;
  switch (range) {
    case '6mo':
      entries = [
        ...(history.daily || []),
        ...(history.weekly || []),
      ];
      break;
    case '2yr':
      entries = [
        ...(history.daily || []),
        ...(history.weekly || []),
        ...(history.monthly || []),
      ];
      break;
    default: // 90d
      entries = history.daily || [];
  }

  return entries
    .map(e => {
      const date = e.date || e.startDate;
      const ts = toTimestamp(date);
      if (!ts) return null;
      return {
        ts,
        weight: typeof e.weight === 'number' ? e.weight : (e.weight?.lbs ?? null),
        calories: typeof e.nutrition === 'object' ? (e.nutrition?.calories ?? null) : null,
        workoutMinutes: e.workouts?.totalMinutes ?? (
          Array.isArray(e.workouts)
            ? e.workouts.reduce((t, w) => t + (w.duration || 0), 0)
            : 0
        ),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

export default function HistoryChart({ history }) {
  const [range, setRange] = useState('90d');

  const chartOptions = useMemo(() => {
    const data = buildChartData(history, range);
    if (!data.length) return null;

    return {
      chart: {
        backgroundColor: 'transparent',
        height: 300,
      },
      title: { text: null },
      xAxis: {
        type: 'datetime',
        labels: {
          style: { color: '#999', fontSize: '10px' },
          rotation: -45,
        },
        lineColor: 'rgba(255,255,255,0.1)',
      },
      yAxis: [
        {
          title: { text: 'Weight (lbs)', style: { color: '#7cb5ec' } },
          labels: { style: { color: '#7cb5ec' } },
          gridLineColor: 'rgba(255,255,255,0.05)',
        },
        {
          title: { text: 'Calories', style: { color: '#f7a35c' } },
          labels: { style: { color: '#f7a35c' } },
          opposite: true,
          gridLineColor: 'transparent',
        },
        {
          title: { text: 'Workout (min)', style: { color: '#90ed7d' } },
          labels: { style: { color: '#90ed7d' } },
          opposite: true,
          gridLineColor: 'transparent',
        },
      ],
      series: [
        {
          name: 'Weight',
          type: 'spline',
          yAxis: 0,
          data: data.filter(d => d.weight != null).map(d => [d.ts, d.weight]),
          color: '#7cb5ec',
          marker: { radius: 2 },
        },
        {
          name: 'Calories',
          type: 'line',
          yAxis: 1,
          data: data.filter(d => d.calories != null).map(d => [d.ts, d.calories]),
          color: '#f7a35c',
          marker: { radius: 1 },
          dashStyle: 'ShortDash',
        },
        {
          name: 'Workout',
          type: 'column',
          yAxis: 2,
          data: data.filter(d => d.workoutMinutes > 0).map(d => [d.ts, d.workoutMinutes]),
          color: 'rgba(144, 237, 125, 0.5)',
          borderWidth: 0,
          pointWidth: range === '2yr' ? 8 : range === '6mo' ? 4 : 3,
        },
      ],
      legend: {
        itemStyle: { color: '#ccc', fontSize: '11px' },
      },
      tooltip: {
        shared: true,
        backgroundColor: 'rgba(30, 30, 50, 0.9)',
        style: { color: '#fff' },
        borderColor: 'rgba(255,255,255,0.1)',
      },
      credits: { enabled: false },
    };
  }, [history, range]);

  if (!chartOptions) return null;

  return (
    <div>
      <Group gap="xs" mb="sm">
        {RANGES.map(r => (
          <Button
            key={r.key}
            size="xs"
            variant={range === r.key ? 'filled' : 'outline'}
            color="gray"
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </Group>
      <HighchartsReact highcharts={Highcharts} options={chartOptions} />
    </div>
  );
}
