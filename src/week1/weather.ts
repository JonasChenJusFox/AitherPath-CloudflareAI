import { ApiError } from "../utils/api";

export type WeatherResult = {
  location: string;
  temperatureC: number;
  windSpeedKmh: number;
  weatherCode: number;
  observedAt: string;
};

type GeocodeResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
  }>;
};
type ForecastResponse = {
  current?: {
    temperature_2m: number;
    wind_speed_10m: number;
    weather_code: number;
    time: string;
  };
};

export async function getCurrentWeather(city: string): Promise<WeatherResult> {
  const geocode = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  );
  if (!geocode.ok)
    throw new ApiError(
      "WEATHER_API_ERROR",
      "Weather geocoding is unavailable.",
      502
    );
  const place = (await geocode.json<GeocodeResponse>()).results?.[0];
  if (!place)
    throw new ApiError(
      "VALIDATION_ERROR",
      `No location found for ${city}.`,
      404
    );

  const forecast = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`
  );
  if (!forecast.ok)
    throw new ApiError(
      "WEATHER_API_ERROR",
      "Weather forecast is unavailable.",
      502
    );
  const current = (await forecast.json<ForecastResponse>()).current;
  if (!current)
    throw new ApiError(
      "WEATHER_API_ERROR",
      "Weather provider returned no current conditions.",
      502
    );

  return {
    location: [place.name, place.country].filter(Boolean).join(", "),
    temperatureC: current.temperature_2m,
    windSpeedKmh: current.wind_speed_10m,
    weatherCode: current.weather_code,
    observedAt: current.time
  };
}
