import type { SearchResult } from '../shared/types';
import { asksLocalConditions } from './readings';

/**
 * A local weather ask in the US reads the National Weather Service forecast for that place
 * (keyless): Open-Meteo finds the place, NWS gives the forecast periods. The row leads the
 * sources, so the card's high, low and sky are the official ones and not a news page's.
 */

const UA = 'zo-search/1.0 (https://zo.fyi; ask@zo.fyi)';
const TIMEOUT_MS = 2500;
const WHEN = /\s+(?:today|tonight|tomorrow|this (?:morning|afternoon|evening|weekend|week)|right now|now|this hour)\s*$/i;
const ALIAS: Record<string, string> = { nyc: 'New York', 'new york city': 'New York', la: 'Los Angeles', sf: 'San Francisco', dc: 'Washington', philly: 'Philadelphia' };

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** "What's the forecast high in New York City today?" → { city: "New York" }. "Austin, TX weather" → Austin in Texas. */
export function weatherPlace(query: string): { city: string; state?: string } | undefined {
  if (!asksLocalConditions(query)) return undefined;
  const q = query.trim().replace(/[?.!]+$/, '').replace(WHEN, '').trim();
  const raw = q.match(/\b(?:in|for|at|near|around)\s+([A-Z][\w.' -]{1,40}?(?:,\s*[A-Za-z .]{2,20})?)$/)?.[1]
    ?? q.match(/^([A-Z][\w.' -]{1,40}?(?:,\s*[A-Za-z .]{2,20})?)\s+(?:weather|forecast|temperature)\b/)?.[1];
  if (!raw) return undefined;
  const [name, region] = raw.split(/\s*,\s*/);
  const city = ALIAS[name!.trim().toLowerCase()] ?? name!.trim();
  const state = region ? STATES[region.trim().toUpperCase()] ?? region.trim() : /^(?:nyc|new york city)$/i.test(name!.trim()) ? 'New York' : undefined;
  return city.length >= 2 ? { city, ...(state ? { state } : {}) } : undefined;
}

async function getJson<T>(url: string, ms: number): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/geo+json, application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as T;
}

type Place = { name: string; latitude: number; longitude: number; country_code?: string; admin1?: string; population?: number };
type Period = { name: string; temperature: number; temperatureUnit: string; shortForecast: string; detailedForecast: string; isDaytime: boolean };

/** The NWS forecast for a US place named in a weather ask, as a source row. Undefined outside the US or on any failure. */
export async function nwsForecastRow(query: string): Promise<SearchResult | undefined> {
  const place = weatherPlace(query);
  if (!place) return undefined;
  const started = Date.now();
  const left = () => Math.max(300, TIMEOUT_MS - (Date.now() - started));
  try {
    const found = await getJson<{ results?: Place[] }>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place.city)}&count=10&language=en&format=json`, left());
    const all = found.results ?? [];
    // "Paris" is Paris, France: a US town of that name answers only when the state is named or it is the best match.
    if (!place.state && all[0]?.country_code !== 'US') return undefined;
    const us = all.filter((row) => row.country_code === 'US' && (!place.state || row.admin1?.toLowerCase() === place.state.toLowerCase()));
    const hit = place.state ? us.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0] : all[0];
    if (!hit) return undefined;
    const lat = hit.latitude.toFixed(4);
    const lon = hit.longitude.toFixed(4);
    const point = await getJson<{ properties?: { forecast?: string } }>(`https://api.weather.gov/points/${lat},${lon}`, left());
    if (!point.properties?.forecast) return undefined;
    const forecast = await getJson<{ properties?: { periods?: Period[]; updated?: string } }>(point.properties.forecast, left());
    const periods = forecast.properties?.periods ?? [];
    if (!periods.length) return undefined;
    const where = `${hit.name}, ${hit.admin1 ?? 'US'}`;
    const line = (p: Period) => `${p.name}: ${p.detailedForecast}`;
    console.log(JSON.stringify({ zo: 'nws', place: where, periods: periods.length, ms: Date.now() - started }));
    return {
      title: `National Weather Service forecast for ${where}`,
      url: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
      domain: 'forecast.weather.gov',
      snippet: periods.slice(0, 2).map(line).join(' ').slice(0, 400),
      content: `Official National Weather Service forecast for ${where}${forecast.properties?.updated ? `, updated ${forecast.properties.updated}` : ''}.\n${periods.slice(0, 8).map(line).join('\n')}`,
      engines: ['nws'],
      date: forecast.properties?.updated?.slice(0, 10),
    };
  } catch (err) {
    console.log(JSON.stringify({ zo: 'nws', failed: String(err instanceof Error ? err.message : err).slice(0, 80), ms: Date.now() - started }));
    return undefined;
  }
}
