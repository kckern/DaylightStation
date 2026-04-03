import React, { useState, useMemo } from 'react';
import { Group, Button } from '@mantine/core';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const RANGES = [
  { key: '90d', label: '90 Days' },
  { key: '6mo', label: '6 Months' },
  { key: '2yr', label: '2 Years' },
];

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

  // Sort by date ascending
  entries = entries
    .map(e => ({
      date: e.date || e.startDate,
      weight: typeof e.weight === 'number' ? e.weight : e.weight?.lbs || null,
      calories: typeof e.nutrition === 'object' ? e.nutrition?.calories : null,
      workoutMinutes: e.workouts?.totalMinutes ?? (
        Array.isArray(e.workouts)
          ? e.workouts.reduce((t, w) => t + (w.duration || 0), 0)
          : 0
      ),
    }))
    .filter(e => e.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return entries;
}

export default function HistoryChart({ history }) {
  const [range, setRange] = useState('90d');

  const chartOptions = useMemo(() => {
    const data = buildChartData(history, range);
    const categories = data.map(d => d.date);

    return {
      chart: {
        backgroundColor: 'transparent',
        height: 300,
      },
      title: { text: null },
      xAxis: {
        categories,
        labels: {
          style: { color: '#999', fontSize: '10px' },
          step: Math.max(1, Math.floor(categories.length / 10)),
          rotation: -45,
        },
        lineColor: 'rgba(255,255,255,0.1)',
      },
      yAxis: [
        {
          // Left: Weight
          title: { text: 'Weight (lbs)', style: { color: '#7cb5ec' } },
          labels: { style: { color: '#7cb5ec' } },
          gridLineColor: 'rgba(255,255,255,0.05)',
        },
        {
          // Right: Calories
          title: { text: 'Calories', style: { color: '#f7a35c' } },
          labels: { style: { color: '#f7a35c' } },
          opposite: true,
          gridLineColor: 'transparent',
        },
        {
          // Far right: Workout minutes
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
          data: data.map(d => d.weight),
          color: '#7cb5ec',
          connectNulls: true,
          marker: { radius: 2 },
        },
        {
          name: 'Calories',
          type: 'line',
          yAxis: 1,
          data: data.map(d => d.calories),
          color: '#f7a35c',
          connectNulls: true,
          marker: { radius: 1 },
          dashStyle: 'ShortDash',
        },
        {
          name: 'Workout',
          type: 'column',
          yAxis: 2,
          data: data.map(d => d.workoutMinutes || 0),
          color: 'rgba(144, 237, 125, 0.5)',
          borderWidth: 0,
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
