import { useState, useEffect } from 'react';
import { DaylightAPI } from '../lib/api.mjs';
import React from 'react';
import Highcharts, { color } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import moment from 'moment';

export default function WeatherForecast() {
  const [temps, setTemps] = useState([]);
  const [times, setTimes] = useState([]);

  const celciusToFahrenheit = (temp) => Math.round(temp * 9/5 + 32);

  const reloadData = () => {
    DaylightAPI('/data/weather').then((response) => {
        const list = response.hourly || [];
        const endTime = moment().add(36, 'hours');
        const isFuture = ({time}) => moment(time).isAfter(moment()) && moment(time).isBefore(endTime);
      const futureList = list.filter(isFuture);
      const temps = futureList.map((item) => item.feel).map(celciusToFahrenheit) || [];
      const times = futureList.map((item) => item.time).map((time) => moment(time).format('ha')) || [];

      //every n hours
      const n = 5;
      setTemps(temps.filter((_, i) => i % n === 0));
      setTimes(times.filter((_, i) => i % n === 0));
    }
    );
  }

    useEffect(() => {
        reloadData();
        const interval = setInterval(reloadData, 300000);
        return () => clearInterval(interval);
    }, []);

const minTemp = Math.min(...temps);
const options = {
    credits: {
        enabled: false
    },
    chart: {
        type: 'column',
        animation: false,
        backgroundColor: '#00000000',
        style: {
            color: '#ffffff'
        },
        //height 200
        height: 200,
        spacing: [10, 10, 10, 10]
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
        animation: { duration: 0 },
        color: '#e9c46a',
        borderColor: '#FFFFFF55',
        dataLabels: {
            enabled: true,
            align: 'center',
            verticalAlign: 'top',
            inside: true,
            formatter: function() {
                return '' + this.y + '°';
            },
            style: {
                fontFamily: 'Roboto Condensed',
                fontSize: '24',
                fontWeight: 'bold',
                paddingLeft: '1ex',
                color: '#000'
            }
        }
    }],
    xAxis: {
        categories: times,
        labels: {
            style: {
                color: '#ffffff',
                fontSize: '20px',
                fontFamily: 'Roboto Condensed'

            },
            rotation: -45,
            x: 10,
            y: 15
        },
        lineColor: '#ffffff',
        lineWidth: 2
    },
    yAxis: {
        visible: false,
        title: {
            enabled: false
        },
        gridLineWidth: 0,
        min: minTemp - 5,
    },
    legend: {
        enabled: false
    },
    plotOptions: {
        column: {
            groupPadding: -0.05
        }
    }
};
  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
