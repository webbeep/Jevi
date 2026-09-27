/**
 * The UI grammar an answer card is composed from. Layout nodes arrange children;
 * display nodes render content. The designer (Jev picks the skeleton, DeepSeek
 * refines and fills it) may combine these freely — nothing is tied to a topic.
 */

/** search = new web search, ask = answer as a new card from these results, refine = redesign this card. */
export type ActionKind = 'search' | 'ask' | 'refine';

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
  | { type: 'stat'; label: string; value: string; unit?: string; icon?: string; delta?: string; trend?: 'up' | 'down' | 'flat' }
  | { type: 'tile'; label: string; value?: string; sub?: string; icon?: string; imageRef?: number; imageQuery?: string; imageSrc?: string; active?: boolean }
  | { type: 'keyvalue'; items: { label: string; value: string; icon?: string }[] }
  | { type: 'list'; style?: 'bullet' | 'check' | 'number' | 'icon' | 'media'; items: { text: string; icon?: string; meta?: string; imageRef?: number; imageQuery?: string; imageSrc?: string }[] }
  | { type: 'chart'; kind: 'bar' | 'hbar' | 'line' | 'area' | 'pie'; title?: string; unit?: string; data: { label: string; value: number }[] }
  | { type: 'progress'; label: string; value: number; caption?: string }
  | { type: 'rating'; value: number; max?: number; label?: string }
  | { type: 'table'; columns: string[]; rows: string[][]; highlight?: number }
  | { type: 'timeline'; items: { when: string; title: string; text?: string }[] }
  | { type: 'steps'; items: { title: string; detail?: string }[] }
  | { type: 'proscons'; pros: string[]; cons: string[] }
  | { type: 'badges'; items: string[] }
  | { type: 'quote'; text: string; source?: string }
  | { type: 'callout'; tone?: Tone; title?: string; text: string; icon?: string }
  /** Pictures reference IMAGES by index, or name what they show (`query`) for the server to find. */
  | { type: 'image'; ref?: number; query?: string; src?: string; link?: string; caption?: string; aspect?: 'wide' | 'square' | 'tall' }
  | { type: 'gallery'; refs: number[]; query?: string; pics?: { src: string; link: string; title: string }[] }
  | { type: 'profile'; name: string; subtitle?: string; imageRef?: number; imageQuery?: string; imageSrc?: string; facts?: { label: string; value: string }[] }
  | { type: 'actions'; items: { label: string; icon?: string; query: string; kind?: ActionKind }[] }
  // Interactive
  | { type: 'choices'; label?: string; options: { label: string; prompt: string; selected?: boolean }[] }
  | { type: 'slider'; label: string; min: number; max: number; step?: number; value: number; unit?: string; prompt: string }
  | { type: 'scaler'; label: string; base: number; value?: number; min: number; max: number; step?: number; unit?: string; items: { name: string; amount: number; unit?: string }[] }
  | { type: 'accordion'; items: { title: string; text: string }[] }
  | { type: 'reveal'; items: { front: string; back: string }[] }
  | { type: 'citations'; refs: number[] }
  // Placeholder rendered while content is on its way
  | { type: 'slot'; hint: string; shape?: 'hero' | 'line' | 'block' | 'tile' | 'chart' | 'row' };

export type NodeType = CardNode['type'];

export interface AnswerCard {
  title: string;
  subtitle?: string;
  icon?: string;
  accent?: Tone;
  body: CardNode[];
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
  engine: 'deepseek' | 'reasoning' | 'extractive';
  pagesRead: number;
  removed: number;
  ms: number;
}
