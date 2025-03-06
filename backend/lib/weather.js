import { saveFile, loadFile } from './io.js';
import { fetchWeatherApi } from 'openmeteo';
import moment from 'moment';
import 'moment-timezone';
moment.tz.setDefault('UTC');


const getWeather = async () => {
    const { OPEN_WEATHER_API_KEY, weather: { lat, lng, timezone} } = process.env;

    const weatherParams = {
        "latitude": lat,
        "longitude": lng,
        "hourly": ["temperature_2m", "apparent_temperature", "precipitation", "weather_code", "cloud_cover"],
        "forecast_days": 3
    };

    const airQualityParams = {
        "latitude": lat,
        "longitude": lng,
        "current": ["pm10", "pm2_5", "us_aqi","european_aqi"]
    };

    const weatherUrl = "https://api.open-meteo.com/v1/forecast";
    const airQualityUrl = "https://air-quality-api.open-meteo.com/v1/air-quality";

    const [weatherResponses, airQualityResponse] = await Promise.all([
        fetchWeatherApi(weatherUrl, weatherParams),
        fetchWeatherApi(airQualityUrl, airQualityParams)
    ]);

    const range = (start, stop, step) =>
        Array.from({ length: (stop - start) / step }, (_, i) => start + i * step);

    const weatherResponse = weatherResponses[0];
    const currentAir = airQualityResponse[0].current();
    //console.log(currentAir);    
    const utcOffsetSeconds = weatherResponse.utcOffsetSeconds();
    const hourlyWeather = weatherResponse.hourly();

    const weatherData = {
        current: {
            feel: hourlyWeather.variables(1).valuesArray()[0],
            temp: hourlyWeather.variables(0).valuesArray()[0],
            precip: hourlyWeather.variables(2).valuesArray()[0],
            code: hourlyWeather.variables(3).valuesArray()[0],
            cloud: hourlyWeather.variables(4).valuesArray()[0],
            aqi: currentAir.variables(2).value(),
            pm10: currentAir.variables(0).value(),
            pm2_5: currentAir.variables(1).value(),
        },
        hourly: range(Number(hourlyWeather.time()), Number(hourlyWeather.timeEnd()), hourlyWeather.interval()).map(
            (t, index) => ({
                time: moment.tz((t + utcOffsetSeconds) * 1000, timezone).format('YYYY-MM-DD HH:mm:ss'),
                temp: hourlyWeather.variables(0).valuesArray()[index],
                feel: hourlyWeather.variables(1).valuesArray()[index],
                precip: hourlyWeather.variables(2).valuesArray()[index],
                cloud: hourlyWeather.variables(4).valuesArray()[index]
            })
        ),
    };

    saveFile('weather', weatherData);
    return weatherData;
}

export default getWeather;