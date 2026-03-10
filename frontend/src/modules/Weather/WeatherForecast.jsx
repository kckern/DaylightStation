import { useState, useEffect, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import React from 'react';
import Highcharts, { color } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import moment from 'moment';
import { useScreenData } from '../../screen-framework/data/ScreenDataProvider.jsx';

export default function WeatherForecast({ weatherData: weatherDataProp }) {
  const screenData = useScreenData('weather');
  const weatherData = weatherDataProp || screenData;
  const [temps, setTemps] = useState([]);
  const [times, setTimes] = useState([]);
  const [chartHeight, setChartHeight] = useState(0);
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  const celciusToFahrenheit = (temp) => Math.round(temp * 9/5 + 32);

  const processWeatherData = (data) => {
    if (!data?.hourly) return;

    const list = data.hourly || [];
    const endTime = moment().add(36, 'hours');
    const isFuture = ({time}) => moment(time).isAfter(moment()) && moment(time).isBefore(endTime);
    const futureList = list.filter(isFuture);
    const temps = futureList.map((item) => ({temp: celciusToFahrenheit(item.temp), precip:item.precip, day: moment(item.time).format('ddd')}));
    const times = futureList.map((item) => item.time).map((time) => moment(time).format('ha')) || [];

    const n = 5;
    setTemps(temps.filter((_, i) => i % n === 0));
    setTimes(times.filter((_, i) => i % n === 0));
  };

  useEffect(() => {
    if (weatherData) processWeatherData(weatherData);
  }, [weatherData]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) {
        setChartHeight(h);
        const chart = chartRef.current?.chart;
        if (chart) chart.setSize(el.offsetWidth, h, false);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!weatherData || temps.length === 0) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '0 10px' }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton rect" style={{ width: '10%', height: `${Math.random() * 50 + 30}%` }} />
        ))}
      </div>
    );
  }

  const minTemp = Math.min(...temps.map(({temp}) => temp));
  const midnightIndices = times.map((t, i) => t === '12am' ? i : -1).filter(i => i >= 0);
  const midnightLines = midnightIndices.map(i => ({
    value: i - 0.5, color: '#ffffff55', width: 2, zIndex: 5,
    dashStyle: 'Solid'
  }));

  // Responsive sizing
  const h = chartHeight || 80;
  const isSmall = h < 120;
  const labelSize = isSmall ? '11px' : '18px';
  const timeFontSize = isSmall ? '8px' : '11px';

  const options = {
    credits: { enabled: false },
    chart: {
      type: 'column',
      animation: false,
      backgroundColor: '#00000000',
      style: { color: '#ffffff' },
      margin: [0, 0, 0, 0],
      spacing: [0, 0, 0, 0],
      height: h
    },
    title: { text: '' },
    series: [{
      name: 'Temperature',
      data: temps.map(({temp, precip}) => {
        const colors = {
          "32": "#FFFFFF",
          "40": "#a9def9",
          "50": "#00bbf9",
          "60": "#2a9d8f",
          "70": "#fcbf49",
          "80": "#f77f00",
          "90": "#d62828",
          "100": "#9e2a2b"
        };
        const thresholds = Object.keys(colors).map(Number);
        const barColor = precip > 1 ? "#81a4cd"
          : colors[thresholds.find(t => temp < t)] || "#90be6d";

        return {
          y: temp,
          color: barColor,
          dataLabels: {
            x: 0,
            y: precip > 1 ? (isSmall ? -20 : -30) : 0,
            style: { color: 'contrast', textOutline: '2px contrast' }
          },
        };
      }),
      animation: { duration: 0 },
      color: '#e9c46a',
      borderColor: '#FFFFFF55',
      dataLabels: {
        enabled: true,
        align: 'center',
        verticalAlign: 'top',
        inside: true,
        formatter: function() {
          const isPrecip = temps[this.point.index].precip > 1;
          if (isPrecip) return (isSmall ? '💧' : '🌧️') + '<br/>' + this.y + '°';
          return '' + this.y + '°';
        },
        style: {
          fontFamily: 'Roboto Condensed',
          fontSize: labelSize,
          fontWeight: 'bold',
          color: '#000'
        }
      }
    }],
    xAxis: {
      categories: times,
      labels: { enabled: false },
      lineColor: '#ffffff',
      lineWidth: 1,
      plotLines: []
    },
    yAxis: {
      visible: false,
      title: { enabled: false },
      gridLineWidth: 0,
      min: Math.max(0, minTemp - 10),
    },
    legend: { enabled: false },
    plotOptions: {
      column: { groupPadding: -0.05 }
    }
  };

  // Group bars by day
  const dayGroups = [];
  temps.forEach(({ day }) => {
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.day === day) last.count++;
    else dayGroups.push({ day, count: 1 });
  });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <HighchartsReact ref={chartRef} highcharts={Highcharts} options={options} />
      {/* Day labels + full-height dividers */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', fontFamily: 'Roboto Condensed', fontSize: timeFontSize, color: '#ffffffaa', fontWeight: 'bold', pointerEvents: 'none' }}>
        {dayGroups.map(({ day, count }, i) => (
          <span key={i} style={{ flex: count, paddingLeft: '3px', borderLeft: i > 0 ? '1px solid #ffffff55' : 'none' }}>{day}</span>
        ))}
      </div>
      {/* Time labels overlaid at bottom */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-around', fontFamily: 'Roboto Condensed', fontSize: timeFontSize, color: '#000', fontWeight: 'bold', opacity: 0.6, pointerEvents: 'none' }}>
        {times.map((t, i) => <span key={i}>{t}</span>)}
      </div>
    </div>
  );
}
