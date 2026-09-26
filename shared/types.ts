export type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  engines: string[];
  image?: string;
  date?: string;
}

export interface ImageResult {
  url: string;
  thumb: string;
  title: string;
  source: string;
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

export type Intent =
  | 'definition'
  | 'how_to'
  | 'comparison'
  | 'news'
  | 'person'
  | 'place'
  | 'product'
  | 'statistics'
  | 'history'
  | 'opinion'
  | 'technical'
  | 'general';

export type ComponentKind =
  | 'answer'
  | 'summary'
  | 'knowledge'
  | 'stats'
  | 'timeline'
  | 'gallery'
  | 'key_points'
  | 'comparison'
  | 'steps'
  | 'pros_cons'
  | 'discussion'
  | 'results';

export type AiTask = 'summary' | 'comparison' | 'steps' | 'pros_cons' | 'followups';

export type SummaryLength = 'short' | 'medium' | 'long';

export type ActionId = 'simpler' | 'deeper' | 'latest' | 'alternatives' | 'howto' | 'images' | 'reviews' | 'history';

export interface Action {
  id: ActionId;
  label: string;
  query: string;
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

export interface FillResult {
  answer?: KeyPoint & { confidence: number };
  keyPoints: KeyPoint[];
  stats: Stat[];
  timeline: TimelineItem[];
  blocks: ComponentKind[];
}

export interface Layout {
  intent: Intent;
  intentConfidence: number;
  blocks: ComponentKind[];
  answer?: KeyPoint & { confidence: number };
  keyPoints: KeyPoint[];
  stats: Stat[];
  timeline: TimelineItem[];
  aiTasks: AiTask[];
  summaryLength: SummaryLength;
  actions: Action[];
  engine: 'jev' | 'heuristic';
  ms: number;
}

export interface Comparison {
  columns: string[];
  rows: { label: string; values: string[] }[];
}

export interface AiResult {
  summary?: string;
  comparison?: Comparison;
  steps?: { title: string; detail: string }[];
  pros?: string[];
  cons?: string[];
  followups?: string[];
}

export interface GenerateRequest {
  query: string;
  tasks: AiTask[];
  length: SummaryLength;
  simple: boolean;
  results: SearchResult[];
  knowledge?: Knowledge;
}

export interface AskRequest {
  query: string;
  question: string;
  results: SearchResult[];
}

export type AskResponse =
  | { kind: 'answer'; answer: string }
  | { kind: 'search'; query: string };

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
  tldr: string;
  bullets: string[];
}

export interface HealthResponse {
  jev: boolean;
  deepseek: boolean;
  keyedEngines: string[];
}
