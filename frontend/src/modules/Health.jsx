import { useState, useEffect } from "react";
import { DaylightAPI } from "../lib/api.mjs";
import "./Health.scss";
import Highcharts, { color } from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import moment from 'moment';

export default function Health() {
    const [weightData, setWeightData] = useState([]);
    const [today, setToday] = useState({});
  const reloadData = () => {
    DaylightAPI('/data/weight').then((response) => {
        
        const list = response || [];
        const keys = Object.keys(list);
        setWeightData(list);
        setToday(list[keys[0]]);
    }
    );
  }

    useEffect(() => {
        reloadData();
        const interval = setInterval(reloadData, 300000);
        return () => clearInterval(interval);
    }, []);

    const {lbs_adjusted_average, fat_percent_adjusted_average, lbs_adjusted_average_7day_trend} = today;

    return (
        <div className="health">
            <table style={{width: "100%"}}>
                <thead style={{textAlign: "left"}}>
                    <tr>
                        <th>Weight</th>
                        <th>Composition</th>
                        <th>7 Day Trend</th>
                        <th>Days to 15%</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>{lbs_adjusted_average}</td>
                        <td>?</td>
                        <td>{lbs_adjusted_average_7day_trend}</td>
                        <td>{Math.round(15 / lbs_adjusted_average_7day_trend)}</td>
                    </tr>
                </tbody>
            </table>
            <HealthChart data={Object.keys(weightData).map((key) => weightData[key])} /> 
        </div>
    );


}


function HealthChart({data}) {
	data = data.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-90);
    const minValue = Math.min(...data.map(({lbs_adjusted_average}) => lbs_adjusted_average));
    const maxValue = Math.max(...data.map(({lbs_adjusted_average}) => lbs_adjusted_average));
    const chartMin = minValue - 2;
    const chartMax = maxValue + 2;
    const avgData = data.map(({lbs_adjusted_average}) => lbs_adjusted_average);
    const pointData = data.map(({measurement}) => measurement || null);
    const times = data.map(({date}) => moment(date).format('MMM D'));

	const options = {
		className: 'health-chart',
		chart: {
			backgroundColor: '#00000000',
			//left border 2px white
		},
		title: {
			text: null
		},
		yAxis: {
			min: chartMin,
			max: chartMax,
			
			minorTickInterval: 1,
			minorGridLineWidth: 1,
			minorGridLineColor: '#4E657E',
			tickInterval: 1,
			gridLineWidth: 5,
			gridLineColor: '#FFFFFF66',
			opposite: true,
			offset: -8,
			title: {
				enabled: false
			},
			labels: {
				enabled: true,
				style: {
					color: '#C5D2E0',
					fontFamily: "Roboto Condensed",
					fontSize: "1.3rem"
				},
				format: '{value}\u00A0lbs'
			},
			minorTickLength: 1,
			tickLength: 3,
			minorGridLineWidth: 1,
			gridLineWidth: 1
		},
		xAxis: {
			gridLineWidth: 1,
			gridLineColor: "#88888855",
			tickInterval: 7,
			min: 0,
			maxPadding: 0,
			tickLength: 1,
			categories: times,
			color: '#C5D2E0',
			labels: {
				rotation: -35,
				step: 1,
				maxStaggerLines: 1,
				style: {
					color: '#C5D2E0',
					fontSize: "1.0em",
					fontFamily: "Roboto Condensed",
					fontWeight: "bold",
					padding: 10,
				},
				formatter: (value) => {
					if(value.isFirst) return null;
					return value.value;
				},
				align: "right",
				x: 1,
				y: 20
			},
			plotLines: times.map((time, index) => {
				if (moment(time, 'MMM D').date() === 1) {
					return {
						color: '#FFFFFF66',
						width: 2,
						value: index
					};
				}
				return null;
			}).filter(line => line !== null)
		},
		legend: {
			enabled: false
		},
		plotOptions: {
			areaspline: {
				marker: {
					enabled: false,
					radius: 2,
					fillColor: 'red',
					symbol: 'triangle'
				},
				lineWidth: 2,
				lineColor: '#C5D2E0',
				fillOpacity: 0.2
			},
			scatter: {
				tooltip: {
					headerFormat: '',
					pointFormat: '<b>{point.category}</b>: {point.y} lbs'
				}
			}
		},
		series: [{
			type: 'areaspline',
			name: 'Rolling Average',
			data: avgData,
		},
		{
			type: 'scatter',
			name: 'Measurement',
			data: pointData,
			color: '#C5D2E0',
		}],
		credits: {
			enabled: false
		},
	};

    return (
        <HighchartsReact
            highcharts={Highcharts}
            options={options}
        />
    );
}