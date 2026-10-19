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
  for (const line of `${nws.content ?? ''}\n${nws.snippet ?? ''}`.split('\n')) {
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

/** A local-weather card agrees with the official forecast on today's high. */
export function withinForecast(node: CardNode, forecast: ForecastHigh): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withinForecast(child, forecast)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'hero': {
      if (!contradictsForecast(`${node.label ?? ''} ${node.value}${node.unit ?? ''} ${node.caption ?? ''}`, forecast)) return node;
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
