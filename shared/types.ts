export type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  engines: string[];
  image?: string;
  date?: string;
  /** Readable page text, when the page could be fetched. */
  content?: string;
}

/**
 * How a picture may be shown:
 * - open: Creative Commons / public domain, licensed for commercial use with attribution
 * - stock: free stock library (Pexels, Unsplash) whose license allows commercial use
 * - source: the publisher's own preview image, shown as a credited thumbnail linking back (search-engine style)
 */
export type ImageLicense = 'open' | 'stock' | 'source';

export interface ImageResult {
  /** Page the picture comes from; thumbnails link here. */
  url: string;
  thumb: string;
  title: string;
  source: string;
  license: ImageLicense;
  /** Attribution line, e.g. "Jane Doe · CC BY-SA 4.0 · Wikimedia Commons". */
  credit?: string;
}

export interface Knowledge {
  title: string;
  extract: string;
  url: string;
  image?: string;
  description?: string;
}

export interface Discussion {
  title: string;
  url: string;
  points: number;
  comments: number;
  date: string;
}

export interface EngineStatus {
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface SearchResponse {
  query: string;
  freshness: Freshness;
  results: SearchResult[];
  images: ImageResult[];
  knowledge?: Knowledge;
  discussions: Discussion[];
  engines: EngineStatus[];
}

export interface KeyPoint {
  text: string;
  url?: string;
  domain?: string;
}

export interface Stat {
  value: string;
  label: string;
  url?: string;
}

export interface TimelineItem {
  when: string;
  text: string;
  url?: string;
}

export type SlotKind = 'key_point' | 'stat' | 'timeline' | 'search' | 'explain';

export interface SlotResponse {
  slot: SlotKind;
  confidence: number;
  stat?: Stat;
  timeline?: TimelineItem;
}

export interface ReadResponse {
  url: string;
  title: string;
  text: string;
  tldr: string;
  bullets: string[];
}

export interface HealthResponse {
  jev: boolean;
  deepseek: boolean;
  keyedEngines: string[];
}
