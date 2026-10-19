import type { CardNode } from './card';

export interface ForecastHigh {
  /** The NWS high for the next daytime period, in °F. */
  high: number;
  /** That period's name as NWS gives it: "Today", "Monday", "This Afternoon". */
  day: string;
  /** The forecast's citation number. */
  ref?: number;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The next daytime high from a National Weather Service forecast row ("Monday: Sunny, with a high near 65."). */
export function forecastHigh(rows: readonly { engines?: string[]; content?: string; snippet?: string }[]): ForecastHigh | undefined {
  const at = rows.findIndex((row) => row.engines?.includes('nws'));
  const nws = rows[at];
  if (!nws) return undefined;
  // Periods come one per line, or run together in a snippet ("Tonight: … around 47. Monday: Sunny. High near 65.").
  for (const line of `${nws.content ?? ''}\n${nws.snippet ?? ''}`.split(/\n|(?<=\.)\s+(?=[A-Z][A-Za-z ]{2,20}:\s)/)) {
    const match = line.match(/^([A-Za-z ]+?):\s.*?\bhigh near (-?\d{1,3})\b/i);
    if (match) return { day: match[1]!.trim(), high: Number(match[2]), ref: at + 1 };
  }
  return undefined;
}

/**
 * A component that states today's high and disagrees with the official forecast: "72°F High today · storms late Friday"
 * from a stale news page beside the NWS "Monday: high near 65". A reading for another day ("Wednesday 62°") stays.
 */
function contradictsForecast(text: string, forecast: ForecastHigh): boolean {
  const lower = text.toLowerCase();
  const day = forecast.day.toLowerCase();
  // Only a figure stated as today's (or the forecast day's) high is checked; "Wednesday 62°" is another reading.
  const today = /\bhigh\b/.test(lower) && (/\btoday\b/.test(lower) || (DAYS.includes(day) && lower.includes(day)));
  if (!today) return false;
  const temps = [...text.matchAll(/(-?\d{1,3})\s?°/g)].map((match) => Number(match[1]));
  // A line that also gives the official figure ("Today 65°, Friday 72°") agrees with it.
  return temps.length > 0 && temps.every((temp) => Math.abs(temp - forecast.high) > 2);
}

/** The question asks for the day's high ("forecast high", "how hot will it get", "max temperature"). */
export const asksForHigh = (question: string) => /\b(?:high|highs|how hot|max(?:imum)? temp)/i.test(question);

/** A local-weather card agrees with the official forecast on today's high. */
export function withinForecast(node: CardNode, forecast: ForecastHigh, asksHigh = false): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withinForecast(child, forecast, asksHigh)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'hero': {
      // "What's the forecast high today?" leads with a high: a temperature hero from another page ("71°" read off a
      // news site's widget) that is not the official high is replaced, even without the word "high" on it.
      const temp = Number(`${node.value}`.match(/^-?\d{1,3}/)?.[0]);
      const offHigh = asksHigh && /°|deg/i.test(`${node.value}${node.unit ?? ''}`) && Number.isFinite(temp) && Math.abs(temp - forecast.high) > 2;
      if (!offHigh && !contradictsForecast(`${node.label ?? ''} ${node.value}${node.unit ?? ''} ${node.caption ?? ''}`, forecast)) return node;
      // The card still leads with the high, the official one.
      const day = /^(?:today|this afternoon)$/i.test(forecast.day) ? 'today' : forecast.day;
      return { type: 'hero', value: String(forecast.high), unit: '°F', label: `High ${day}`, caption: `National Weather Service forecast${forecast.ref ? ` [${forecast.ref}]` : ''}`, icon: node.icon, tone: node.tone };
    }
    case 'tile':
      return contradictsForecast(`${node.label} ${node.value ?? ''} ${node.sub ?? ''}`, forecast) ? undefined : node;
    case 'stat':
      return contradictsForecast(`${node.label} ${node.value}${node.unit ?? ''}`, forecast) ? undefined : node;
    case 'text':
    case 'callout': {
      const kept = node.text.split(/(?<=[.!?])\s+/).filter((sentence) => !contradictsForecast(sentence, forecast)).join(' ').trim();
      if (kept === node.text) return node;
      return kept ? { ...node, text: kept } : undefined;
    }
    default:
      return node;
  }
}
