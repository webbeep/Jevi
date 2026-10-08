/**
 * The UI grammar an answer card is composed from. Layout nodes arrange children;
 * display nodes render content. The designer (Jev picks the skeleton, a language model
 * refines and fills it) may combine these freely — nothing is tied to a topic.
 */

import type { BillingBasis, Price } from './pricing';
import type { ImageLicense } from './types';

/** search = new web search, ask = answer as a new card, refine = a new card that adjusts this one. */
export type ActionKind = 'search' | 'ask' | 'refine';

/**
 * Where a follow-up came from when it is not typed: a card control or button.
 * adjust = new card that is this card with a change; ask = answer about it; search = new web search about it.
 */
export type FollowupIntent = 'adjust' | 'ask' | 'search';

export type Tone = 'default' | 'muted' | 'primary' | 'positive' | 'negative' | 'warning';
export type Gap = 'sm' | 'md' | 'lg';

export type CardNode =
  // Layout
  | { type: 'stack'; direction?: 'row' | 'col'; gap?: Gap; align?: 'start' | 'center' | 'end' | 'between'; wrap?: boolean; children: CardNode[] }
  | { type: 'grid'; cols: 2 | 3 | 4; gap?: Gap; children: CardNode[] }
  | { type: 'section'; title?: string; icon?: string; tone?: Tone; children: CardNode[] }
  | { type: 'tabs'; tabs: { label: string; children: CardNode[] }[] }
  | { type: 'scroller'; children: CardNode[] }
  | { type: 'divider' }
  // Display
  | { type: 'hero'; value: string; unit?: string; label?: string; caption?: string; icon?: string; tone?: Tone }
  | { type: 'heading'; text: string; eyebrow?: string; level?: 1 | 2 | 3 }
  | { type: 'text'; text: string; tone?: Tone; size?: 'sm' | 'md' | 'lg' }
  | { type: 'stat'; label: string; value: string; unit?: string; icon?: string; delta?: string; trend?: 'up' | 'down' | 'flat'; /** https picture of what the stat is about (e.g. a player); optional. */ image?: string }
  /** `source` (a source number) makes the tile open that page. */
  | { type: 'tile'; label: string; value?: string; sub?: string; icon?: string; imageRef?: number; imageQuery?: string; imageSrc?: string; active?: boolean; source?: number }
  | { type: 'keyvalue'; items: { label: string; value: string; icon?: string }[] }
  | { type: 'list'; style?: 'bullet' | 'check' | 'number' | 'icon' | 'media'; items: { text: string; icon?: string; meta?: string; imageRef?: number; imageQuery?: string; imageSrc?: string; source?: number }[] }
  /** Pages, videos or sites to open, by source number — links only ever point at real search results. */
  | { type: 'links'; items: { source: number; label?: string; note?: string }[] }
  /** A video from the sources, played in place when the site allows embedding. */
  | { type: 'video'; source: number; caption?: string }
  | { type: 'chart'; kind: 'bar' | 'hbar' | 'line' | 'area' | 'pie'; title?: string; unit?: string; data: { label: string; value: number }[] }
  | { type: 'progress'; label: string; value: number; caption?: string }
  | { type: 'rating'; value: number; max?: number; label?: string }
  | { type: 'table'; columns: string[]; rows: string[][]; highlight?: number }
  | { type: 'timeline'; items: { when: string; title: string; text?: string; source?: number }[] }
  | { type: 'steps'; items: { title: string; detail?: string }[] }
  | { type: 'proscons'; pros: string[]; cons: string[] }
  | { type: 'badges'; items: string[] }
  | { type: 'quote'; text: string; source?: string }
  | { type: 'callout'; tone?: Tone; title?: string; text: string; icon?: string }
  /** Something the person asked to have written (email, message, post, letter), ready to copy. */
  | { type: 'draft'; label?: string; text: string }
  | { type: 'code'; lang?: string; code: string }
  /** Pictures reference IMAGES by index, or name what they show (`query`) for the server to find. */
  | { type: 'image'; ref?: number; query?: string; src?: string; link?: string; caption?: string; aspect?: 'wide' | 'square' | 'tall' }
  | { type: 'gallery'; refs: number[]; query?: string; pics?: { src: string; link: string; title: string }[] }
  | { type: 'profile'; name: string; subtitle?: string; imageRef?: number; imageQuery?: string; imageSrc?: string; facts?: { label: string; value: string }[] }
  | { type: 'actions'; items: { label: string; icon?: string; query: string; kind?: ActionKind }[] }
  // Interactive
  | { type: 'choices'; label?: string; options: { label: string; prompt: string; selected?: boolean }[] }
  | { type: 'slider'; label: string; min: number; max: number; step?: number; value: number; unit?: string; prompt: string }
  | { type: 'scaler'; label: string; base: number; value?: number; min: number; max: number; step?: number; unit?: string; items: { name: string; amount: number; unit?: string }[] }
  /**
   * Plan prices. Totals are seats × the published amount (or the flat tier), computed in the client.
   * Changing seats or billing does not start a new search.
   */
  | { type: 'pricing'; label?: string; seats: number; min?: number; max?: number; billing: BillingBasis; plans: { name: string; note?: string; prices: Price[] }[] }
  | { type: 'accordion'; items: { title: string; text: string }[] }
  | { type: 'reveal'; items: { front: string; back: string }[] }
  | { type: 'citations'; refs: number[] }
  // Placeholder rendered while content is on its way
  | { type: 'slot'; hint: string; shape?: 'hero' | 'line' | 'block' | 'tile' | 'chart' | 'row' };

export type NodeType = CardNode['type'];

export interface ImageCredit {
  src: string;
  link: string;
  credit: string;
  license: ImageLicense;
}

/**
 * PROVISIONAL — Backend entity patch, shape not final. "Which one?" options when a name is ambiguous.
 * Read ONLY through readChoices() in shared/choices.ts, so field names change in one place.
 */
export interface Disambiguation { prompt?: string; options: { name: string; descriptor?: string; query?: string }[] }

export interface AnswerCard {
  title: string;
  subtitle?: string;
  icon?: string;
  accent?: Tone;
  body: CardNode[];
  /** Attribution for pictures the server found for this card. */
  credits?: ImageCredit[];
  /** "Which one?" options, when the answer hangs on an ambiguous name. */
  choices?: Disambiguation;
}

export interface CardPattern {
  id: string;
  label: string;
  description: string;
}

export interface LayoutPlan {
  query: string;
  pattern: string;
  alternatives: CardPattern[];
  skeleton: AnswerCard;
  engine: 'jev' | 'heuristic';
  confidence: number;
  depth: 'brief' | 'standard' | 'detailed';
  readPages: boolean;
  /** Only set when planning a follow-up. */
  mode?: FollowupMode;
  /** Whether the answer deserves step-by-step reasoning before it is designed. */
  think?: boolean;
  /** For refine follow-ups: which on-screen card the person means. */
  target?: number;
  ms: number;
}

export type FollowupMode = 'refine' | 'answer' | 'chat' | 'search';

export interface FollowupContext {
  mode: Exclude<FollowupMode, 'search'>;
  question: string;
  baseCard?: AnswerCard;
}

export interface CardResponse {
  card: AnswerCard;
  followups: string[];
  engine: 'composed' | 'reasoning' | 'extractive';
  pagesRead: number;
  removed: number;
  ms: number;
  /** The language model provider that wrote the card. */
  via?: string;
  /** Set when the server marked this answer degraded (T418). */
  degraded?: boolean;
  degradedReason?: string;
  /** "Which one?" options the answer came with, when a name was ambiguous. */
  choices?: Disambiguation;
}
