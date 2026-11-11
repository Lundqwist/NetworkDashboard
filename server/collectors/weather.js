// Weather from Open-Meteo (free, no API key).
import { request } from '../lib/http.js';

export const defaultRefresh = 900;

export async function collect(panel) {
  const q = new URLSearchParams({
    latitude: panel.latitude,
    longitude: panel.longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '6',
    wind_speed_unit: panel.windUnit || 'ms',
    temperature_unit: panel.temperatureUnit || 'celsius',
  });
  const res = await request(`https://api.open-meteo.com/v1/forecast?${q}`, { timeout: 10000 });
  if (res.status !== 200) throw new Error(`Open-Meteo answered HTTP ${res.status}`);
  const j = res.json();

  const now = Date.now();
  const offset = (j.utc_offset_seconds || 0) * 1000;
  // Open-Meteo returns local wall-clock times without offset; convert to epoch ms.
  const toEpoch = (s) => Date.parse(`${s}Z`) - offset;
  const hours = j.hourly.time
    .map((t, i) => ({
      t: toEpoch(t),
      temp: j.hourly.temperature_2m[i],
      pop: j.hourly.precipitation_probability[i],
      code: j.hourly.weather_code[i],
    }))
    .filter((h) => h.t >= now - 3_600_000)
    .slice(0, 24);

  return {
    location: panel.location || '',
    units: { temp: j.current_units?.temperature_2m || '°C', wind: j.current_units?.wind_speed_10m || 'm/s' },
    current: {
      temp: j.current.temperature_2m,
      feels: j.current.apparent_temperature,
      humidity: j.current.relative_humidity_2m,
      wind: j.current.wind_speed_10m,
      code: j.current.weather_code,
      isDay: !!j.current.is_day,
    },
    sunrise: toEpoch(j.daily.sunrise[0]),
    sunset: toEpoch(j.daily.sunset[0]),
    hourly: hours,
    daily: j.daily.time.map((d, i) => ({
      date: d,
      code: j.daily.weather_code[i],
      max: j.daily.temperature_2m_max[i],
      min: j.daily.temperature_2m_min[i],
      pop: j.daily.precipitation_probability_max[i],
    })),
  };
}
