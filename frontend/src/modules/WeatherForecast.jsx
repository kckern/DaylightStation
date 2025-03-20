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
      const temps = futureList.map((item) => ({temp: celciusToFahrenheit(item.feel), precip:item.precip}));
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

const minTemp = Math.min(...temps.map(({temp}) => temp)) - 5;
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
        marginTop: -10,
        //height 200
        height: 160,
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
        data: temps.map(({temp,precip}) => {

            console.log({temp});
            const colors = {
                "32": "#FFFFFF", //Freezing
                "40": "#a9def9", //Coat weather
                "50": "#00bbf9", //Jacket
                "60": "#a7c957", //Sweater
                "70": "#fcbf49", //T-shirt
                "80": "#f77f00", //Shorts
                "90": "#d62828",  //Hot
                "100": "#9e2a2b"  //Very Hot
            };
            const thresholds = Object.keys(colors).map(Number);
            const color = precip > 1 ? "#81a4cd"           
            :colors[thresholds.find(threshold => temp < threshold)] || "#90be6d"; // Default color


            return {
                y: temp,
                color,
                dataLabels: {
                    x: 2, // Adjust x position for data labels
                    y:precip > 1 ? -26 : 0, // Adjust y position based on precip
                    style: {
                        color: 'contrast',
                        textOutline: '2px contrast'
                    }
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
                if (isPrecip) {
                    return '🌧️<br/>' + this.y + '°';
                }
                return '' + this.y + '°';
            },
            style: {
                fontFamily: 'Roboto Condensed',
                fontSize: '18',
                fontWeight: 'bold',
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
            x: 20, // Updated x offset to 10px
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
