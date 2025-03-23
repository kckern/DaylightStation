import { useState, useEffect } from "react";
import { DaylightAPI } from "../lib/api.mjs";
import moment from "moment-timezone";
import green from "../assets/icons/green.png";
import yellow from "../assets/icons/yellow.png";
import red from "../assets/icons/red.png";
import lime from "../assets/icons/lime.png";

const codes = {
  "0": {
    day: {
      description: "Sunny",
      image: "http://openweathermap.org/img/wn/01d@2x.png"
    },
    night: {
      description: "Clear",
      image: "http://openweathermap.org/img/wn/01n@2x.png"
    }
  },
  "1": {
    day: {
      description: "Mainly Sunny",
      image: "http://openweathermap.org/img/wn/01d@2x.png"
    },
    night: {
      description: "Mainly Clear",
      image: "http://openweathermap.org/img/wn/01n@2x.png"
    }
  },
  "2": {
    day: {
      description: "Partly Cloudy",
      image: "http://openweathermap.org/img/wn/02d@2x.png"
    },
    night: {
      description: "Partly Cloudy",
      image: "http://openweathermap.org/img/wn/02n@2x.png"
    }
  },
  "3": {
    day: {
      description: "Cloudy",
      image: "http://openweathermap.org/img/wn/03d@2x.png"
    },
    night: {
      description: "Cloudy",
      image: "http://openweathermap.org/img/wn/03n@2x.png"
    }
  },
  "45": {
    day: {
      description: "Foggy",
      image: "http://openweathermap.org/img/wn/50d@2x.png"
    },
    night: {
      description: "Foggy",
      image: "http://openweathermap.org/img/wn/50n@2x.png"
    }
  },
  "48": {
    day: {
      description: "Rime Fog",
      image: "http://openweathermap.org/img/wn/50d@2x.png"
    },
    night: {
      description: "Rime Fog",
      image: "http://openweathermap.org/img/wn/50n@2x.png"
    }
  },
  "51": {
    day: {
      description: "Light Drizzle",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Light Drizzle",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "53": {
    day: {
      description: "Drizzle",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Drizzle",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "55": {
    day: {
      description: "Heavy Drizzle",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Heavy Drizzle",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "56": {
    day: {
      description: "Light Freezing Drizzle",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Light Freezing Drizzle",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "57": {
    day: {
      description: "Freezing Drizzle",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Freezing Drizzle",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "61": {
    day: {
      description: "Light Rain",
      image: "http://openweathermap.org/img/wn/10d@2x.png"
    },
    night: {
      description: "Light Rain",
      image: "http://openweathermap.org/img/wn/10n@2x.png"
    }
  },
  "63": {
    day: {
      description: "Rain",
      image: "http://openweathermap.org/img/wn/10d@2x.png"
    },
    night: {
      description: "Rain",
      image: "http://openweathermap.org/img/wn/10n@2x.png"
    }
  },
  "65": {
    day: {
      description: "Heavy Rain",
      image: "http://openweathermap.org/img/wn/10d@2x.png"
    },
    night: {
      description: "Heavy Rain",
      image: "http://openweathermap.org/img/wn/10n@2x.png"
    }
  },
  "66": {
    day: {
      description: "Light Freezing Rain",
      image: "http://openweathermap.org/img/wn/10d@2x.png"
    },
    night: {
      description: "Light Freezing Rain",
      image: "http://openweathermap.org/img/wn/10n@2x.png"
    }
  },
  "67": {
    day: {
      description: "Freezing Rain",
      image: "http://openweathermap.org/img/wn/10d@2x.png"
    },
    night: {
      description: "Freezing Rain",
      image: "http://openweathermap.org/img/wn/10n@2x.png"
    }
  },
  "71": {
    day: {
      description: "Light Snow",
      image: "http://openweathermap.org/img/wn/13d@2x.png"
    },
    night: {
      description: "Light Snow",
      image: "http://openweathermap.org/img/wn/13n@2x.png"
    }
  },
  "73": {
    day: {
      description: "Snow",
      image: "http://openweathermap.org/img/wn/13d@2x.png"
    },
    night: {
      description: "Snow",
      image: "http://openweathermap.org/img/wn/13n@2x.png"
    }
  },
  "75": {
    day: {
      description: "Heavy Snow",
      image: "http://openweathermap.org/img/wn/13d@2x.png"
    },
    night: {
      description: "Heavy Snow",
      image: "http://openweathermap.org/img/wn/13n@2x.png"
    }
  },
  "77": {
    day: {
      description: "Snow Grains",
      image: "http://openweathermap.org/img/wn/13d@2x.png"
    },
    night: {
      description: "Snow Grains",
      image: "http://openweathermap.org/img/wn/13n@2x.png"
    }
  },
  "80": {
    day: {
      description: "Light Showers",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Light Showers",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "81": {
    day: {
      description: "Showers",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Showers",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "82": {
    day: {
      description: "Heavy Showers",
      image: "http://openweathermap.org/img/wn/09d@2x.png"
    },
    night: {
      description: "Heavy Showers",
      image: "http://openweathermap.org/img/wn/09n@2x.png"
    }
  },
  "85": {
    day: {
      description: "Light Snow Showers",
      image: "http://openweathermap.org/img/wn/13d@2x.png"
    },
    night: {
      description: "Light Snow Showers",
      image: "http://openweathermap.org/img/wn/13n@2x.png"
    }
  },
  "86": {
    day: {
      description: "Snow Showers",
      image: "http://openweathermap.org/img/wn/13d@2x.png"
    },
    night: {
      description: "Snow Showers",
      image: "http://openweathermap.org/img/wn/13n@2x.png"
    }
  },
  "95": {
    day: {
      description: "Thunderstorm",
      image: "http://openweathermap.org/img/wn/11d@2x.png"
    },
    night: {
      description: "Thunderstorm",
      image: "http://openweathermap.org/img/wn/11n@2x.png"
    }
  },
  "96": {
    day: {
      description: "Light Thunderstorms With Hail",
      image: "http://openweathermap.org/img/wn/11d@2x.png"
    },
    night: {
      description: "Light Thunderstorms With Hail",
      image: "http://openweathermap.org/img/wn/11n@2x.png"
    }
  },
  "99": {
    day: {
      description: "Thunderstorm With Hail",
      image: "http://openweathermap.org/img/wn/11d@2x.png"
    },
    night: {
      description: "Thunderstorm With Hail",
      image: "http://openweathermap.org/img/wn/11n@2x.png"
    }
  }
};

export default function Weather() {
  const celciusToFahrenheit = temp => Math.round(temp * 9 / 5 + 32);
  const isDaytime = () =>
    moment().isBetween(
      moment().startOf("day").hour(6),
      moment().startOf("day").hour(18)
    );

  const [currentWeather, setCurrentWeather] = useState({});

  const reloadData = () => {
    DaylightAPI("/data/weather").then(({ current }) => {
      current.temp = celciusToFahrenheit(current.temp);
      current.feel = celciusToFahrenheit(current.feel);
      current = {
        ...current,
        ...codes[current.code][isDaytime() ? "day" : "night"]
      };
      current.aircolor =
        current.aqi >= 150
          ? red
          : current.aqi >= 100 ? yellow : current.aqi >= 50 ? lime : green;
      setCurrentWeather(current);
    });
  };

  useEffect(() => {
    reloadData();
    const interval = setInterval(reloadData, 300000);
    return () => clearInterval(interval);
  }, []);
  if (!currentWeather.temp) return null;

  return (
    <table
      style={{
        width: "100%",
        textAlign: "center",
        fontSize: "1.2rem",
        lineHeight: "1",
        borderCollapse: "collapse",
        marginTop: "-1.5rem",
        marginBottom: "-1rem"
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "1rem", border: "0", textAlign: "center" }} align="center" width={"50%"}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <img
                src={currentWeather.image}
                alt={currentWeather.description}
                style={{ margin: "-2ex", display: "block" }}
              />
              <div
                style={{
                  fontSize: "2.5rem",
                  fontWeight: "bold",
                  marginBottom: "0.2rem"
                }}
              >
                {currentWeather.temp}°
              </div>
              <div>{currentWeather.description}</div>
            </div>
          </td>
          <td style={{ padding: "1rem", border: "0 solid #ddd" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <img
                src={currentWeather.aircolor}
                alt={"Air Quality"}
                style={{ height: "3rem", margin: "0 auto", display: "block" }}
              />
              <div>Air Quality:</div>
              <div
                style={{
                  fontSize: "3rem",
                  fontWeight: "bold"
                }}
              >
                {Math.round(currentWeather.aqi)}
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
