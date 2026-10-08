/**
 * Curated home starter prompts. Only IDs listed in PASSING_IDS (and
 * starters.pass.json) may be shown. Pool math matches
 * HOME-STARTERS-DECISION-2026-10-07.
 */

export type StarterGroup = 's1' | 'broad';
export type StarterKind = 'compare' | 'plan' | 'explain' | 'draw';

export interface Starter {
  id: string;
  text: string;
  icon: string;
  group: StarterGroup;
  kind: StarterKind;
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

/**
 * IDs that passed the 3/3 render gate on 2026-10-07 (see starters.pass.json
 * and HOME-STARTERS-DECISION-2026-10-07 §2). Keep in sync with the JSON.
 */
export const PASSING_IDS = [
  's1-workspace-4',
  's1-helpdesk-20',
  'broad-kindle-kobo',
  'broad-10k',
] as const;

/** Full library (candidates + passing). Non-passing IDs never appear on home. */
export const STARTERS: Starter[] = [
  { id: 's1-workspace-4', text: 'which Google Workspace plan fits 4 people', icon: 'building-2', group: 's1', kind: 'compare' },
  { id: 's1-helpdesk-20', text: 'help desk tool under $20/seat', icon: 'headset', group: 's1', kind: 'compare' },
  { id: 's1-crm-5-50', text: 'best CRM for 5 people under $50/mo', icon: 'users', group: 's1', kind: 'compare' },
  { id: 's1-notion-coda', text: 'Notion vs Coda for a 3-person agency', icon: 'notebook', group: 's1', kind: 'compare' },
  { id: 's1-project-slack', text: 'cheapest project tool with Slack + GitHub', icon: 'kanban', group: 's1', kind: 'compare' },
  { id: 's1-linear-jira', text: 'Linear vs Jira for 10 engineers', icon: 'square-kanban', group: 's1', kind: 'compare' },
  { id: 's1-invoicing', text: 'best invoicing app for freelancers', icon: 'receipt', group: 's1', kind: 'compare' },
  { id: 's1-zapier-make', text: 'Zapier vs Make for 2k tasks/mo', icon: 'workflow', group: 's1', kind: 'compare' },
  { id: 'broad-kindle-kobo', text: 'Kindle vs Kobo for reading', icon: 'book-open', group: 'broad', kind: 'compare' },
  { id: 'broad-10k', text: '8-week plan to run my first 10K', icon: 'footprints', group: 'broad', kind: 'plan' },
  { id: 'broad-tokyo', text: 'Plan a 3-day Tokyo trip on a budget', icon: 'map', group: 'broad', kind: 'plan' },
  { id: 'broad-heat-pump', text: 'Explain how a heat pump works', icon: 'thermometer', group: 'broad', kind: 'explain' },
];

const PASS_SET = new Set<string>(PASSING_IDS);

export const PASSING_STARTERS: Starter[] = STARTERS.filter((s) => PASS_SET.has(s.id) && !s.requires);

/** Exact texts in the home pool (memo §2 PASS rows). */
export const PASSING_TEXTS = PASSING_STARTERS.map((s) => s.text);

const SHOWN_PHONE = 3;
const SHOWN_DESKTOP = 4;
/** Pool must be ≥3× shown per group before shuffle turns on. */
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
  const s1 = passing.filter((s) => s.group === 's1').length;
  const broad = passing.filter((s) => s.group === 'broad').length;
  // Desktop slots: up to 3 S1 / 2 broad → need ≥9 S1 and ≥6 broad.
  return s1 >= 3 * POOL_MULT && broad >= 2 * POOL_MULT;
}

/**
 * Pick the home set: phones 2 S1 + 1 broad (3 total); desktop 2 S1 + 2 broad (4).
 * Order is random each call. Only passing IDs.
 */
export function pickShown(width: number, rand: () => number = Math.random, excludeIds: Set<string> = new Set()): Suggestion[] {
  const s1 = shuffleInPlace(
    PASSING_STARTERS.filter((s) => s.group === 's1' && !excludeIds.has(s.id)),
    rand,
  );
  const broad = shuffleInPlace(
    PASSING_STARTERS.filter((s) => s.group === 'broad' && !excludeIds.has(s.id)),
    rand,
  );
  const want = shownCount(width);
  const wantS1 = Math.min(2, s1.length);
  const wantBroad = Math.min(want - wantS1, broad.length);
  const picked = [...s1.slice(0, wantS1), ...broad.slice(0, wantBroad)];
  if (picked.length < want) {
    const rest = shuffleInPlace(
      PASSING_STARTERS.filter((s) => !picked.some((p) => p.id === s.id) && !excludeIds.has(s.id)),
      rand,
    );
    picked.push(...rest.slice(0, want - picked.length));
  }
  return shuffleInPlace(picked, rand).map(({ id, text, icon, group }) => ({ id, text, icon, group }));
}

/** All passing starters as API suggestions (e2e checks length ≥ 4). */
export function allPassingSuggestions(): Suggestion[] {
  return PASSING_STARTERS.map(({ id, text, icon, group }) => ({ id, text, icon, group }));
}

/** Placeholder examples: one S1 + one broad from the passing pool. */
export function placeholderExamples(): [string, string] {
  const s1 = PASSING_STARTERS.find((s) => s.group === 's1')?.text ?? 'Ask anything';
  const broad = PASSING_STARTERS.find((s) => s.group === 'broad')?.text ?? 'Ask anything';
  return [s1, broad];
}
