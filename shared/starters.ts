/**
 * Curated home starters, v2 (RICKY-FEEDBACK-T364 #1, Strategy set in
 * org/eng/zo/STARTERS-v2.md). Generic everyday questions, one per rich card
 * layout. Fixed order: phones show #1–#3, desktop shows all 4. Only IDs in
 * PASSING_IDS (and starters.pass.json) may be shown.
 */

export type StarterGroup = 's1' | 'broad';
export type StarterKind = 'compare' | 'plan' | 'explain' | 'draw' | 'ranked' | 'steps' | 'decision';
/** Card node type the starter is chosen to showcase. */
export type StarterCard = 'list' | 'table' | 'steps' | 'proscons';

export interface Starter {
  id: string;
  text: string;
  icon: string;
  group: StarterGroup;
  kind: StarterKind;
  /** Rich card node this starter must render (QA gate). */
  card?: StarterCard;
  /** Set when a starter must wait for another patch (e.g. diagrams). */
  requires?: 'F';
}

/** Suggestion shape used by /api/suggestions and the home list. */
export interface Suggestion {
  id: string;
  text: string;
  icon: string;
  group: StarterGroup;
}

/** Shown on home, in display order (phones take the first 3). Keep in sync with the JSON. */
export const PASSING_IDS = [
  'v2-earbuds-100',
  'v2-airfryer-instantpot',
  'v2-wine-stain',
  'v2-lease-buy-car',
] as const;

/** Full library: v2 primaries, same-card backups, then retired sets (never shown unless passing). */
export const STARTERS: Starter[] = [
  { id: 'v2-earbuds-100', text: 'best wireless earbuds under $100', icon: 'headphones', group: 'broad', kind: 'ranked', card: 'list' },
  { id: 'v2-airfryer-instantpot', text: 'air fryer vs Instant Pot for a small kitchen', icon: 'cooking-pot', group: 'broad', kind: 'compare', card: 'table' },
  { id: 'v2-wine-stain', text: 'how to get a red wine stain out of a carpet', icon: 'wine', group: 'broad', kind: 'steps', card: 'steps' },
  { id: 'v2-lease-buy-car', text: 'should I lease or buy my next car', icon: 'car', group: 'broad', kind: 'decision', card: 'proscons' },
  // Backups (same card type as the primary in the same position).
  { id: 'v2b-robot-vacuum-300', text: 'best robot vacuum under $300', icon: 'bot', group: 'broad', kind: 'ranked', card: 'list' },
  { id: 'v2b-costco-sams', text: "Costco vs Sam's Club membership", icon: 'shopping-cart', group: 'broad', kind: 'compare', card: 'table' },
  { id: 'v2b-jump-start', text: 'how to jump-start a car', icon: 'battery-charging', group: 'broad', kind: 'steps', card: 'steps' },
  { id: 'v2b-rent-buy-home', text: 'renting vs buying a home', icon: 'house', group: 'broad', kind: 'decision', card: 'proscons' },
  // Retired H set (2026-10-07).
  { id: 's1-workspace-4', text: 'which Google Workspace plan fits 4 people', icon: 'building-2', group: 's1', kind: 'compare' },
  { id: 's1-helpdesk-20', text: 'help desk tool under $20/seat', icon: 'headset', group: 's1', kind: 'compare' },
  { id: 'broad-kindle-kobo', text: 'Kindle vs Kobo for reading', icon: 'book-open', group: 'broad', kind: 'compare' },
  { id: 'broad-10k', text: '8-week plan to run my first 10K', icon: 'footprints', group: 'broad', kind: 'plan' },
];

const PASS_SET = new Set<string>(PASSING_IDS);

/** Passing starters in PASSING_IDS display order. */
export const PASSING_STARTERS: Starter[] = PASSING_IDS
  .map((id) => STARTERS.find((s) => s.id === id))
  .filter((s): s is Starter => !!s && PASS_SET.has(s.id) && !s.requires);

/** Exact texts in the home pool. */
export const PASSING_TEXTS = PASSING_STARTERS.map((s) => s.text);

const SHOWN_PHONE = 3;
const SHOWN_DESKTOP = 4;
/** Pool must be ≥3× shown before shuffle turns on. */
const POOL_MULT = 3;

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function isPhoneWidth(width: number): boolean {
  return width <= 640;
}

export function shownCount(width: number): number {
  return isPhoneWidth(width) ? SHOWN_PHONE : SHOWN_DESKTOP;
}

export function canShuffle(passing = PASSING_STARTERS): boolean {
  return passing.length >= SHOWN_DESKTOP * POOL_MULT;
}

/**
 * Pick the home set: the first 3 (phones) or 4 (desktop) passing starters in
 * display order, so each shown starter showcases a different card layout.
 * `rand` only applies once shuffle is enabled (pool ≥3× shown).
 */
export function pickShown(width: number, rand: () => number = Math.random, excludeIds: Set<string> = new Set()): Suggestion[] {
  const want = shownCount(width);
  let pool = PASSING_STARTERS.filter((s) => !excludeIds.has(s.id));
  if (canShuffle()) pool = shuffleInPlace([...pool], rand);
  return pool.slice(0, want).map(({ id, text, icon, group }) => ({ id, text, icon, group }));
}

/** All passing starters as API suggestions (e2e checks length ≥ 4). */
export function allPassingSuggestions(): Suggestion[] {
  return PASSING_STARTERS.map(({ id, text, icon, group }) => ({ id, text, icon, group }));
}

/** Placeholder examples: the first two passing starters. */
export function placeholderExamples(): [string, string] {
  return [PASSING_STARTERS[0]?.text ?? 'Ask anything', PASSING_STARTERS[1]?.text ?? 'Ask anything'];
}
