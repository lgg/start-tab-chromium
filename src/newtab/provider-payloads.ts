import { validDateOnly } from "../lib/date-validation.js";
export { validDateOnly } from "../lib/date-validation.js";

export interface IpResult { ip: string; country: string }
export interface WeatherDay { date: string; min: number; max: number; code: number }
export interface WeatherResult {
  currentTemperature: number | null;
  currentCode: number | null;
  unit: string;
  dailyUnit: string;
  days: WeatherDay[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}


function validIp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 45) return false;
  const candidate = value.trim();
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(candidate)) {
    return candidate.split(".").every((part) => Number(part) <= 255);
  }
  if (!candidate.includes(":") || !/^[0-9a-f:.]+$/i.test(candidate)) return false;
  try {
    return new URL("http://[" + candidate + "]/").hostname.startsWith("[");
  } catch { return false; }
}

export function parseIpPayload(payload: unknown): IpResult | null {
  const source = record(payload);
  if (!source || source.success === false || source.error === true || source.status === "fail") return null;
  const ip = [source.ip, source.query, source.address].find(validIp);
  if (!ip) return null;
  const country = [source.country_name, source.country, source.countryCode, source.country_code]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return { ip: ip.trim(), country: country?.trim().slice(0, 100) ?? "" };
}

function weatherCode(value: unknown): number | null {
  const code = finite(value);
  return code !== null && Number.isInteger(code) && code >= 0 && code <= 99 ? code : null;
}

export function parseWeatherPayload(payload: unknown): WeatherResult {
  const source = record(payload);
  if (!source || source.error === true) throw new Error("Invalid weather response");
  const current = record(source.current);
  const units = record(source.current_units);
  const daily = record(source.daily);
  const dailyUnits = record(source.daily_units);
  const readUnit = (value: unknown): string => typeof value === "string" ? value.trim().slice(0, 16) : "";
  const currentUnit = readUnit(units?.temperature_2m);
  const minUnit = readUnit(dailyUnits?.temperature_2m_min);
  const maxUnit = readUnit(dailyUnits?.temperature_2m_max);
  const consistentDailyUnits = !minUnit || !maxUnit || minUnit === maxUnit;
  const dailyUnit = minUnit || maxUnit || currentUnit || "°C";
  const dates = Array.isArray(daily?.time) ? daily.time : [];
  const mins = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const maxes = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const codes = Array.isArray(daily?.weather_code) ? daily.weather_code : [];
  const days: WeatherDay[] = [];
  const seen = new Set<string>();
  for (const [index, date] of (consistentDailyUnits ? dates.slice(0, 31) : []).entries()) {
    const min = finite(mins[index]);
    const max = finite(maxes[index]);
    const code = weatherCode(codes[index]);
    if (!validDateOnly(date) || seen.has(date) || min === null || max === null || min > max || code === null) continue;
    seen.add(date);
    days.push({ date, min, max, code });
  }
  const temperature = finite(current?.temperature_2m);
  if (temperature === null && days.length === 0) throw new Error("Weather response has no usable data");
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { currentTemperature: temperature, currentCode: weatherCode(current?.weather_code), unit: currentUnit || (consistentDailyUnits ? dailyUnit : "°C"), dailyUnit, days };
}
