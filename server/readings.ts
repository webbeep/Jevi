import type { CardNode } from '../shared/card';

/**
 * A local-conditions card (weather, forecast, temperature) has only a handful of
 * numbers. Parallel region designers cannot see each other, so the same reading
 * lands in the hero, a key-value list, a "now" scroller and a stat grid.
 * Collapse keeps the first copy of each reading. The same tile twice (two
 * "tonight" temperatures, two rain chances, two winds) is one fact, whatever
 * the wording. A later period with its own number stays. A price that also
 * appears in a chart or a table stays: those nodes are a different presentation
 * and are never rewritten here.
 */

const READING_LABELS = new Set([
  'temperature',
  'humidity',
  'dew point',
  'pressure',
  'visibility',
  'rainfall',
  'snow depth',
  'wind',
  'feels like',
  'price',
  'uv',
  'uv index',
  'cloud cover',
  'rain chance',
]);

const LABEL_ALIAS: Record<string, string> = {
  temp: 'temperature',
  temperature: 'temperature',
  humidity: 'humidity',
  humid: 'humidity',
  'dew point': 'dew point',
  dewpoint: 'dew point',
  pressure: 'pressure',
  barometer: 'pressure',
  'barometric pressure': 'pressure',
  visibility: 'visibility',
  rainfall: 'rainfall',
  rain: 'rainfall',
  precipitation: 'rainfall',
  'rain chance': 'rain chance',
  'chance of rain': 'rain chance',
  'probability of rain': 'rain chance',
  'probability of precipitation': 'rain chance',
  'precip chance': 'rain chance',
  'precipitation chance': 'rain chance',
  'chance of precipitation': 'rain chance',
  'snow depth': 'snow depth',
  snow: 'snow depth',
  snowfall: 'snow depth',
  wind: 'wind',
  'wind speed': 'wind',
  feels: 'feels like',
  'feels like': 'feels like',
  price: 'price',
  uv: 'uv',
  'uv index': 'uv index',
  'cloud cover': 'cloud cover',
  cloudiness: 'cloud cover',
};

const UNIT_WORD = /^(?:f|c|mi|in|mph|km|mm|cm|mb|hpa|kph|miles|mile|inches|inch|percent|degrees?)$/i;
const CONDITION = /\b(?:cloudy|sunny|clear|rainy?|snowy?|foggy?|windy|stormy|overcast|humid|fair)\b/i;
const GENERIC_TITLE = /^(?:the\s+|current\s+|local\s+|today'?s\s+)*(?:weather|forecast|temperature)(?:\s+(?:now|today|report|update))?$/i;

const STOP_WORD = new Set(['of', 'the', 'a', 'an', 'and']);
/** Words that narrow a fact without naming a different one: "tonight's low" is still tonight. */
const QUALIFIER_WORD = new Set(['low', 'high', 'min', 'max', 'minimum', 'maximum', 'speed']);
const WORD_ALIAS: Record<string, string> = {
  precip: 'rain',
  precipitation: 'rain',
  rainfall: 'rain',
  probability: 'chance',
  probabilities: 'chance',
  winds: 'wind',
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

interface Fact {
  /** Sorted words of the label, so "rain chance" and "chance of rain" meet. */
  key: string;
  nums: string[];
  text: string;
}

interface Seen {
  readings: Set<string>;
  phrases: Set<string>;
  facts: Fact[];
}

function fresh(): Seen {
  return { readings: new Set(), phrases: new Set(), facts: [] };
}

function numKey(raw: string): string {
  return raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => numKey(m[0]));
}

function absNums(text: string): string[] {
  return numbersIn(text).map((n) => numKey(String(Math.abs(Number(n)))));
}

function factWords(label: string): string[] {
  const words = label
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORD.has(w) && !QUALIFIER_WORD.has(w) && !UNIT_WORD.test(w))
    .map((w) => WORD_ALIAS[w] ?? w);
  const nums = absNums(label);
  return nums.length ? [...nums, ...words] : words;
}

function factKey(label: string): string {
  const words = factWords(label);
  if (!words.length) return '';
  return [...words].sort().join(' ');
}

function plainFact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The same label and an overlapping number is the same fact. A different number (a high beside a low) stays. */
function repeatsFact(label: string, value: string, seen: Seen): boolean {
  const key = factKey(label);
  if (!key) return false;
  const nums = absNums(value);
  const text = plainFact(value);
  return seen.facts.some((fact) => {
    if (fact.key !== key) return false;
    if (nums.length && fact.nums.length) return nums.some((n) => fact.nums.includes(n));
    if (!nums.length && !fact.nums.length) return !!text && text === fact.text;
    return false;
  });
}

function rememberFact(label: string, value: string, seen: Seen): void {
  const key = factKey(label);
  if (!key) return;
  seen.facts.push({ key, nums: absNums(value), text: plainFact(value) });
}

function hasGlyph(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** A bordered tile with no letters, digits, or picture would draw an empty box. */
function blankShell(node: CardNode): boolean {
  if (node.type === 'tile') {
    if (hasGlyph(`${node.label ?? ''} ${node.value ?? ''} ${node.sub ?? ''}`)) return false;
    return !(node.imageSrc || node.imageRef !== undefined || node.imageQuery);
  }
  if (node.type === 'stat') return !hasGlyph(`${node.label} ${node.value} ${node.unit ?? ''} ${node.delta ?? ''}`);
  return false;
}

function labelKey(label: string): string {
  const norm = label
    .toLowerCase()
    .replace(/-?\d+(?:\.\d+)?/g, ' ')
    .replace(/[%°]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !UNIT_WORD.test(w))
    .join(' ');
  return LABEL_ALIAS[norm] ?? norm;
}

function readingKey(text: string, label?: string): string | undefined {
  const nums = numbersIn(text);
  if (nums.length !== 1 && !(label && nums.length >= 1)) return undefined;
  const key = labelKey(label && numbersIn(label).length === 0 ? label : text);
  const value = nums[0];
  if (!value || !READING_LABELS.has(key)) return undefined;
  return `${key}|${value}`;
}

function rememberText(text: string, seen: Seen, label?: string): void {
  const clauses = text.split(/[·•|]/);
  for (const clause of clauses) {
    const key = readingKey(clause, label);
    if (key) seen.readings.add(key);
    const phrase = clause
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (phrase.length >= 4 && CONDITION.test(phrase)) seen.phrases.add(phrase);
  }
}

function restates(text: string, seen: Seen): boolean {
  const low = text.toLowerCase();
  const hit = [...seen.phrases].some((phrase) => phrase.length >= 4 && low.includes(phrase));
  if (!hit) return false;
  const nums = numbersIn(text);
  return nums.every((n) => [...seen.readings].some((key) => key.endsWith(`|${n}`)));
}

function knownAndSeen(text: string, seen: Seen, label?: string): boolean {
  const keys = text
    .split(/[·•|]/)
    .map((clause) => readingKey(clause, label))
    .filter((key): key is string => !!key);
  return keys.length > 0 && keys.every((key) => seen.readings.has(key));
}

function substance(node: CardNode): boolean {
  if (node.type === 'tile') return !!(node.label?.trim() || node.value?.trim() || node.sub?.trim());
  if (node.type === 'stat') return !!(node.label.trim() || node.value.trim());
  if (node.type === 'text' || node.type === 'heading') return !!node.text.trim();
  if (node.type === 'keyvalue') return node.items.length > 0;
  return true;
}

function rememberHero(node: Extract<CardNode, { type: 'hero' }>, seen: Seen): void {
  const shown = `${node.value} ${node.unit ?? ''}`;
  if (/°/.test(shown)) rememberText(`temperature ${node.value}`, seen, 'temperature');
  if (/\$|usd/i.test(shown)) rememberText(`price ${node.value}`, seen, 'price');
  const named = node.label ? labelKey(node.label) : '';
  if (named && READING_LABELS.has(named)) rememberText(`${named} ${node.value}`, seen, named);
  if (node.caption) rememberText(node.caption, seen);
}

const CURRENT_LABEL = /^(?:now|current|right now|today)$/i;

function takeLeaf(node: CardNode, seen: Seen): CardNode | undefined {
  if (blankShell(node) || !substance(node)) return undefined;
  if (node.type === 'tile' || node.type === 'stat') {
    const value = [node.value, node.type === 'stat' ? node.unit : undefined].filter(Boolean).join(' ');
    const primary = [node.label, value].filter(Boolean).join(' ');
    const extra = node.type === 'tile' ? node.sub : undefined;
    const blob = [primary, extra].filter(Boolean).join(' ');
    // "Now / Partly cloudy" restates the hero. "Mon / 72°" is a later period and stays, even when the number matches.
    // A second "Tonight 58°" or "Rain chance 100%" is the same fact and goes, even when the subtitle differs.
    const current = CURRENT_LABEL.test(node.label.trim());
    if (knownAndSeen(primary, seen, node.label) || repeatsFact(node.label, value, seen) || (current && (restates(blob, seen) || knownAndSeen(blob, seen)))) return undefined;
    let next: CardNode = node;
    if (node.type === 'tile' && node.sub && (knownAndSeen(node.sub, seen) || restates(node.sub, seen))) {
      const clauses = node.sub.split(/\s*[·•|]\s*/).filter((clause) => !knownAndSeen(clause, seen) && !restates(clause, seen));
      const sub = clauses.join(' · ').trim();
      next = sub ? { ...node, sub } : { ...node, sub: undefined };
    }
    rememberText(primary, seen, node.label);
    rememberFact(node.label, value, seen);
    if (next.type === 'tile' && next.sub) rememberText(next.sub, seen);
    return next;
  }
  if (node.type === 'keyvalue') {
    const items = node.items.filter((item) => {
      const text = `${item.label} ${item.value}`;
      return !knownAndSeen(text, seen, item.label) && !repeatsFact(item.label, item.value, seen) && !restates(text, seen);
    });
    if (!items.length) return undefined;
    for (const item of items) {
      rememberText(`${item.label} ${item.value}`, seen, item.label);
      rememberFact(item.label, item.value, seen);
    }
    return items.length === node.items.length ? node : { ...node, items };
  }
  if (node.type === 'text' || node.type === 'heading' || node.type === 'callout') {
    const text = node.type === 'callout' ? `${node.title ?? ''} ${node.text}` : node.text;
    rememberText(text, seen);
    return node;
  }
  return node;
}

function take(node: CardNode, seen: Seen): CardNode | undefined {
  if (node.type === 'slot') return undefined;
  if (node.type === 'hero') {
    rememberHero(node, seen);
    return node;
  }
  if (node.type === 'chart' || node.type === 'table' || node.type === 'ticker' || node.type === 'timeline') return node;
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'scroller' || node.type === 'section') {
    const children = node.children.flatMap((child) => {
      const kept = take(child, seen);
      return kept ? [kept] : [];
    });
    if (!children.length) return undefined;
    if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
    return { ...node, children };
  }
  if (node.type === 'tabs') {
    const tabs = node.tabs
      .map((tab) => ({
        ...tab,
        children: tab.children.flatMap((child) => {
          const kept = take(child, seen);
          return kept ? [kept] : [];
        }),
      }))
      .filter((tab) => tab.children.length);
    if (!tabs.length) return undefined;
    if (tabs.length === node.tabs.length && tabs.every((tab, i) => tab.children.length === node.tabs[i]!.children.length && tab.children.every((child, j) => child === node.tabs[i]!.children[j]))) return node;
    return { ...node, tabs };
  }
  return takeLeaf(node, seen);
}

/** Drops a later tile, stat, key-value row, or scroller child that repeats a reading already on the card. */
export function collapseReadings(nodes: readonly (CardNode | undefined)[]): (CardNode | undefined)[] {
  const seen = fresh();
  return nodes.map((node) => (node ? take(node, seen) : node));
}

/** A conditions question, not a definition or a history of climate. */
export function asksLocalConditions(query: string): boolean {
  const s = query.trim();
  if (/\b(?:how (?:do|does)|why (?:do|does|is)|climate|historical|history|average|balloon|satellite)\b/i.test(s)) return false;
  if (/\b(?:weather|forecast)\b/i.test(s)) return true;
  return /\btemperature\b/i.test(s) && !/^(?:what is|what are|explain|define)\b/i.test(s);
}

/** The question already names where ("weather in Seattle", "Seattle weather"). */
export function queryNamesPlace(query: string): boolean {
  if (/\b(?:in|for|at|near|around)\s+\p{Lu}/u.test(query)) return true;
  return /^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,3}\s+(?:weather|forecast|temperature)\b/u.test(query.trim());
}

/** "weather", "what's the weather today", "7 day forecast" — no city in the words. */
export function isBareLocalAsk(query: string): boolean {
  if (queryNamesPlace(query)) return false;
  const q = query.trim().replace(/[?.!]+$/g, '');
  if (/^(?:what(?:'s| is)|how(?:'s| is))?(?:\s+the)?(?:\s+(?:current|local|today'?s?))?\s*(?:weather|forecast|temperature)(?:\s+like)?(?:\s+(?:today|tomorrow|tonight|now|right now|this weekend|this week|outside|near me))?\s*$/i.test(q)) return true;
  return /^(?:\d+[-\s]day\s+)?forecast(?:\s+(?:today|tomorrow|this weekend|this week))?\s*$/i.test(q);
}

/** City from the edge request. Empty when the network did not supply one — never invented. */
export function readerPlace(cf: { city?: unknown; region?: unknown; regionCode?: unknown } | null | undefined): string | undefined {
  if (!cf) return undefined;
  const city = typeof cf.city === 'string' ? cf.city.trim() : '';
  if (!city || city.toUpperCase() === 'XX' || !/\p{L}/u.test(city)) return undefined;
  const code = typeof cf.regionCode === 'string' ? cf.regionCode.trim() : '';
  const region = typeof cf.region === 'string' ? cf.region.trim() : '';
  const suffix = /^[A-Za-z]{2}$/.test(code) && code.toUpperCase() !== 'XX' ? code.toUpperCase() : region && region.toLowerCase() !== city.toLowerCase() ? region : '';
  return suffix ? `${city}, ${suffix}` : city;
}

/** Aims a bare local ask at the reader's city. A question that already names a place is unchanged. */
export function queryWithPlace(query: string, place: string | undefined): string {
  const where = place?.trim();
  if (!where || !isBareLocalAsk(query)) return query;
  return `${query.trim().replace(/[?.!]+$/g, '')} in ${where}`;
}

function asPlace(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().replace(/[?.!]+$/g, '');
  if (!t || t.length > 40 || /\d/.test(t) || GENERIC_TITLE.test(t) || CONDITION.test(t)) return undefined;
  if (/,\s*[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})?$/.test(t) && t.split(/\s+/).length <= 6) return t;
  if (/^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,3}$/u.test(t)) return t;
  return undefined;
}

function placeFromQuery(query: string): string | undefined {
  const inPlace = query.match(/\b(?:in|for|at|near|around)\s+([A-Z][^?.!]{1,40}?)\s*$/);
  if (inPlace) return asPlace(inPlace[1]);
  const lead = query.match(/^([A-Z][^?.!]{1,40}?)\s+(?:weather|forecast|temperature)\b/);
  return lead ? asPlace(lead[1]) : undefined;
}

function heroPlace(nodes: readonly (CardNode | undefined)[]): string | undefined {
  let found: string | undefined;
  const walk = (node: CardNode) => {
    if (found) return;
    if (node.type === 'hero') found = asPlace(node.label);
    if (!found && (node.type === 'stack' || node.type === 'grid' || node.type === 'scroller' || node.type === 'section')) node.children.forEach(walk);
  };
  for (const node of nodes) if (node) walk(node);
  return found;
}

function preferPlace(candidates: (string | undefined)[]): string | undefined {
  const places = candidates.filter((place): place is string => !!place);
  return places.find((place) => place.includes(',')) ?? places[0];
}

function samePlace(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `);
}

function withoutPlaceLabel(node: CardNode, place: string): CardNode {
  if (node.type === 'hero' && node.label && samePlace(node.label, place)) {
    const next = { ...node };
    delete next.label;
    return next;
  }
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'scroller' || node.type === 'section') {
    const children = node.children.map((child) => withoutPlaceLabel(child, place));
    if (children.every((child, i) => child === node.children[i])) return node;
    return { ...node, children };
  }
  if (node.type === 'tabs') {
    const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => withoutPlaceLabel(child, place)) }));
    if (tabs.every((tab, i) => tab.children.every((child, j) => child === node.tabs[i]!.children[j]))) return node;
    return { ...node, tabs };
  }
  return node;
}

/**
 * The card title for a local reading is the place. A generic title ("Weather") is
 * replaced by the place the sources named, or the place in the question.
 * The hero label is cleared when it only repeats that title.
 */
export function settleReadings(
  nodes: readonly (CardNode | undefined)[],
  head: { title: string; subtitle?: string } | undefined,
  query: string,
): { nodes: (CardNode | undefined)[]; head?: { title: string; subtitle?: string } } {
  const collapsed = collapseReadings(nodes);
  if (!head) return { nodes: collapsed };
  const local = asksLocalConditions(query) || GENERIC_TITLE.test(head.title.trim());
  const place = local ? preferPlace([heroPlace(collapsed), asPlace(head.subtitle), placeFromQuery(query)]) : undefined;
  const generic = GENERIC_TITLE.test(head.title.trim());
  const title = place && (generic || !head.title.toLowerCase().includes(place.split(',')[0]!.trim().toLowerCase())) ? place : head.title;
  const subtitle = head.subtitle && place && samePlace(head.subtitle, title) ? undefined : head.subtitle;
  const labeled = place && asPlace(title) ? collapsed.map((node) => (node ? withoutPlaceLabel(node, title) : node)) : collapsed;
  const headChanged = title !== head.title || subtitle !== head.subtitle;
  return { nodes: labeled, ...(headChanged ? { head: { title, subtitle } } : {}) };
}
