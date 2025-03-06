import { useState, useEffect } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import React from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import moment from 'moment';

export default function Weather() {
  const [temps, setTemps] = useState([]);
  const [times, setTimes] = useState([]);

  const gmtOffset = new Date().getTimezoneOffset() * 60;

  useEffect(() => {
    DaylightAPI('/data/weather').then((response) => {
        const now = new Date();
        const futureList = response?.forecast?.list.filter((item) => new Date(item.dt_txt) > now).reverse() || [];

      const list = futureList.slice(0,15) || [];
      const temps = list.map((item) => item.main.feels_like).map(kelvingToFahrenheit) || [];
    const times = list.map((item) => item.dt_txt).map((time) => moment(time).utcOffset(gmtOffset).format('M/D h a')) || [];
      setTemps(temps);
      setTimes(times);
    });
  }, []); 

  const kelvingToFahrenheit = (temp) => Math.round((temp - 273.15) * 9/5 + 32);

  return <WeatherChart times={times} temps={temps} />
}

const WeatherChart = ({ times, temps }) => {
  if (!temps.length || !times.length) return null;
const options = {
    chart: {
        type: 'column',
        animation: false,
        backgroundColor: '#2c2c2c',
        style: {
            color: '#ffffff'
        }
    },
    title: {
        text: '',
        style: {
            color: '#ffffff'
        }
    },
    series: [{
        name: 'Temperature',
        data: temps,
        dataLabels: {
            enabled: true,
            align: 'center',
            verticalAlign: 'top',
            inside: true,
            formatter: function() {
                return this.y + '°';
            },
            style: {
                fontSize: '12px',
                fontWeight: 'bold',
                color: '#ffffff'
            }
        }
    }],
    xAxis: {
        categories: times,
        labels: {
            style: {
                color: '#ffffff'
            }
        }
    },
    yAxis: {
        labels: {
            style: {
                color: '#ffffff'
            }
        },
        title: {
            style: {
                color: '#ffffff'
            }
        }
    },
    legend: {
        //none
        enabled: false
    }
};

  return <HighchartsReact highcharts={Highcharts} options={options} />;
};