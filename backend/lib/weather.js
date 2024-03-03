
import { saveFile, loadFile } from './io.js';
import axios from 'axios';
 

const getWeather = async () => {
    const {OPEN_WEATHER_API_KEY, weather:{lat,lng}} = process.env;

    const commands = ["forecast","air_pollution"];

    let weatherData = {};

    for (let command of commands) {
        const url = `http://api.openweathermap.org/data/2.5/${command}?lat=${lat}&lon=${lng}&APIKEY=${OPEN_WEATHER_API_KEY}`;
        const {data} = await axios.get(url);
        weatherData[command] = data;
    }

    saveFile('weather', weatherData);
    return weatherData;
}

export default getWeather